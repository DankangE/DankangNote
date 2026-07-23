import 'server-only';

import type {
  OrganizationMembershipWebhookEvent,
  OrganizationWebhookEvent,
  UserWebhookEvent,
} from '@clerk/nextjs/webhooks';

import { prisma } from '@/server/db';
import { findTombstoned } from '@/server/services/clerk-tombstone';

// Clerk가 보내는 payload(UserJSON 등)는 webhooks 엔트리에서 직접 export되지 않는다.
// 대신 export되는 판별 유니온에서 upsert 이벤트의 data 타입만 파생한다
// (단순 Extract는 멤버 type이 'created'|'updated' 유니온이라 실패 → deleted를 Exclude).
type UserData = Exclude<UserWebhookEvent, { type: 'user.deleted' }>['data'];
type OrganizationData = Exclude<OrganizationWebhookEvent, { type: 'organization.deleted' }>['data'];
type MembershipData = OrganizationMembershipWebhookEvent['data'];

// ---------- 순서 역전 가드 (KAN-12) ----------
// Svix는 at-least-once·무순서 배달이라 '삭제 후 지연 재전송된 upsert'가 행을 부활시키고,
// '오래된 updated'가 최신 값을 되돌릴 수 있다. 가드 2겹으로 막는다:
// 1) tombstone — 삭제 통보된 id는 영구 기록. upsert는 pre-check로 무시하고, 쓰기와
//    삭제가 겹치면 post-check가 자가 삭제한다. 삭제 핸들러가 tombstone 기록+행 삭제를
//    원자 커밋하므로 어떤 인터리빙에서도 (기록 전 쓰기→행 삭제에 휩쓸림 / 기록 후
//    쓰기→post-check가 정리) 부활 없이 수렴한다.
// 2) clerkUpdatedAt — payload의 updated_at보다 오래된 이벤트는 updateMany 조건
//    불충족 + createMany 중복 스킵으로 걸러진다. upsert 대신 updateMany→createMany를
//    쓰는 이유: 조건부 갱신 표현 + 네이티브 ON CONFLICT(Prisma 7의 upsert는
//    SELECT→INSERT 에뮬레이션이라 동시 실행 시 P2002 — KAN-14에서 실증).

// 저장된 clerkUpdatedAt이 이벤트보다 오래된(또는 스켈레톤이라 null인) 행만 갱신 대상.
function staleGuard(eventAt: Date) {
  return { OR: [{ clerkUpdatedAt: null }, { clerkUpdatedAt: { lt: eventAt } }] };
}

// UserJSON의 대표 이메일: primary가 있으면 그것, 없으면 첫 이메일, 그것도 없으면 null.
function primaryEmail(data: UserData): string | null {
  const primary = data.email_addresses.find((e) => e.id === data.primary_email_address_id);
  return primary?.email_address ?? data.email_addresses[0]?.email_address ?? null;
}

// membership payload의 identifier는 이메일일 수도 유저네임일 수도 있다 — 이메일 형태일 때만 저장.
function emailFromIdentifier(identifier: string): string | null {
  return identifier.includes('@') ? identifier : null;
}

export async function upsertUser(data: UserData): Promise<void> {
  if ((await findTombstoned([data.id])).length > 0) return;

  const eventAt = new Date(data.updated_at);
  const fields = {
    email: primaryEmail(data),
    firstName: data.first_name,
    lastName: data.last_name,
    imageUrl: data.image_url,
    clerkUpdatedAt: eventAt,
  };
  const { count } = await prisma.user.updateMany({
    where: { id: data.id, ...staleGuard(eventAt) },
    data: fields,
  });
  if (count === 0) {
    await prisma.user.createMany({ data: [{ id: data.id, ...fields }], skipDuplicates: true });
  }

  if ((await findTombstoned([data.id])).length > 0) {
    await prisma.user.deleteMany({ where: { id: data.id } });
  }
}

export async function upsertOrganization(data: OrganizationData): Promise<void> {
  if ((await findTombstoned([data.id])).length > 0) return;

  const eventAt = new Date(data.updated_at);
  const fields = {
    name: data.name,
    slug: data.slug,
    imageUrl: data.image_url ?? null,
    clerkUpdatedAt: eventAt,
  };
  const { count } = await prisma.organization.updateMany({
    where: { id: data.id, ...staleGuard(eventAt) },
    data: fields,
  });
  if (count === 0) {
    await prisma.organization.createMany({
      data: [{ id: data.id, ...fields }],
      skipDuplicates: true,
    });
  }

  if ((await findTombstoned([data.id])).length > 0) {
    await prisma.organization.deleteMany({ where: { id: data.id } });
  }
}

// 멤버십 payload는 organization·public_user_data를 임베드한다. FK 성립을 위해 org·user
// 스켈레톤을 먼저 만든다(배달 순서 무관). 임베드 값은 이벤트 시점 스냅샷이라 최신값을
// 되돌릴 수 있어 create에만 쓴다 — 갱신은 organization.*/user.* 이벤트 소관.
// 멤버십 자체는 (orgId, userId) 자연 키 — 재초대(새 orgmem_ id)는 새 이벤트라 가드를
// 통과해 재키잉되고, 삭제→재초대 사이클을 가로질러 온 옛 id의 created/updated는
// clerkUpdatedAt 가드에 걸러져 유령 멤버십(KAN-11 리뷰 경로)이 생기지 않는다.
export async function upsertMembership(data: MembershipData): Promise<void> {
  const org = data.organization;
  const pud = data.public_user_data;
  const userId = pud.user_id;

  if ((await findTombstoned([data.id, org.id, userId])).length > 0) return;

  const eventAt = new Date(data.updated_at);
  await prisma.$transaction([
    prisma.organization.createMany({
      data: [{ id: org.id, name: org.name, slug: org.slug, imageUrl: org.image_url ?? null }],
      skipDuplicates: true,
    }),
    prisma.user.createMany({
      data: [
        {
          id: userId,
          email: emailFromIdentifier(pud.identifier),
          firstName: pud.first_name,
          lastName: pud.last_name,
          imageUrl: pud.image_url,
        },
      ],
      skipDuplicates: true,
    }),
  ]);

  const { count } = await prisma.membership.updateMany({
    where: { orgId: org.id, userId, ...staleGuard(eventAt) },
    data: { id: data.id, role: data.role, clerkUpdatedAt: eventAt },
  });
  if (count === 0) {
    await prisma.membership.createMany({
      data: [{ id: data.id, orgId: org.id, userId, role: data.role, clerkUpdatedAt: eventAt }],
      skipDuplicates: true,
    });
  }

  const tombstoned = await findTombstoned([data.id, org.id, userId]);
  if (tombstoned.length > 0) {
    // 쓰는 사이 삭제가 커밋된 경우 — 방금 만든 행을 자가 정리(org 삭제는 membership을 cascade).
    if (tombstoned.includes(org.id)) {
      await prisma.organization.deleteMany({ where: { id: org.id } });
    }
    if (tombstoned.includes(userId)) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (tombstoned.includes(data.id)) {
      await prisma.membership.deleteMany({ where: { id: data.id } });
    }
  }
}

// 삭제는 tombstone 기록과 행 삭제를 원자 커밋한다 — 위 upsert들의 post-check와 만나
// 어떤 인터리빙에서도 부활이 남지 않는다. createMany skip + deleteMany라 중복 배달도 멱등.

export async function deleteUser(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.clerkTombstone.createMany({ data: [{ id }], skipDuplicates: true }),
    // membership은 onDelete: Cascade, Note.authorId는 SetNull로 함께 처리된다.
    prisma.user.deleteMany({ where: { id } }),
  ]);
}

// 조직 삭제 시 같은 orgId의 Note는 FK Cascade로 함께 파기된다 (KAN-14에서 결정된
// 테넌트 데이터 수명 정책).
export async function deleteOrganization(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.clerkTombstone.createMany({ data: [{ id }], skipDuplicates: true }),
    prisma.organization.deleteMany({ where: { id } }),
  ]);
}

export async function deleteMembership(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.clerkTombstone.createMany({ data: [{ id }], skipDuplicates: true }),
    prisma.membership.deleteMany({ where: { id } }),
  ]);
}
