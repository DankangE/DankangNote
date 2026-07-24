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

// 순서 역전 가드 (KAN-12). Svix는 at-least-once·무순서 배달이라 '삭제 후 지연 재전송된
// upsert'가 행을 부활시키고, '오래된 updated'가 최신 값을 되돌릴 수 있다. 가드 2겹:
// 1) tombstone — 삭제 통보된 id는 영구 기록. 부활 없는 수렴은 세 단계가 서로의 빈틈을
//    받아내며 성립한다 (READ COMMITTED 기준):
//    - upsert의 post-check가 tombstone 커밋 뒤에 실행되면 → post-check가 자가 삭제.
//    - post-check가 tombstone 커밋보다 앞서면 upsert의 쓰기 커밋은 그보다 더 앞이므로
//      → 삭제 핸들러의 커밋 후 sweep이 그 행을 반드시 보고 지운다.
//    - upsert가 쓰기 후·post-check 전에 실패하면 5xx → Svix 재전송 → pre-check가
//      정리를 겸하므로 재전송이 치유한다.
// 2) clerkUpdatedAt — payload의 updated_at보다 오래된 이벤트는 updateMany 조건
//    불충족 + createMany 중복 스킵으로 걸러진다. upsert 대신 updateMany→createMany를
//    쓰는 이유: 조건부 갱신 표현 + 네이티브 ON CONFLICT(Prisma 7의 upsert는
//    SELECT→INSERT 에뮬레이션이라 동시 실행 시 P2002 — KAN-14에서 실증).
//    insert 경합에서 진 쪽이 더 새로운 이벤트일 수 있어 createMany 스킵(count 0) 시
//    updateMany를 한 번 더 시도한다 — 상대 커밋이 끝난 뒤라 가드가 정확히 판정한다.

// 저장된 clerkUpdatedAt이 이벤트보다 새로운 행만 보호한다(스켈레톤 null은 갱신 대상).
// lte인 이유: lt는 같은 ms의 서로 다른 이벤트(생성 직후 즉시 갱신)를 정순 배달에서도
// 영구 드롭한다. lte는 동률을 '마지막 도착 승리'로 바꾼다 — 동률 역순 배달이라는 반대
// 경계가 열리지만 정순 배달이 지배적이라 순개선이고, 동일 이벤트 재전송은 같은 값
// 재기록이라 무해.
function staleGuard(eventAt: Date) {
  return { OR: [{ clerkUpdatedAt: null }, { clerkUpdatedAt: { lte: eventAt } }] };
}

// 세 미러 공통 쓰기 패턴: 가드된 updateMany → 행이 없으면 createMany(skip) →
// insert 경합으로 스킵됐으면 updateMany 재판정 1회(상단 2번 논증). 재시도는 1회다 —
// 그 사이 제3의 핸들러가 행을 또 바꾸는 다중 경합은 이 호출 단독으로는 못 닫고,
// 그 이벤트 자신의 가드/post-check와 다음 이벤트 사이클에서 수렴한다.
async function guardedMirrorWrite(ops: {
  update: () => Promise<{ count: number }>;
  create: () => Promise<{ count: number }>;
}): Promise<void> {
  if ((await ops.update()).count > 0) return;
  if ((await ops.create()).count > 0) return;
  await ops.update();
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
  // pre-check는 정리를 겸한다(상단 수렴 논증) — 이전 배달의 부활 잔여 행을 재전송이 치운다.
  if ((await findTombstoned([data.id])).length > 0) {
    await prisma.user.deleteMany({ where: { id: data.id } });
    return;
  }

  const eventAt = new Date(data.updated_at);
  const fields = {
    email: primaryEmail(data),
    firstName: data.first_name,
    lastName: data.last_name,
    imageUrl: data.image_url,
    clerkUpdatedAt: eventAt,
  };
  await guardedMirrorWrite({
    update: () =>
      prisma.user.updateMany({ where: { id: data.id, ...staleGuard(eventAt) }, data: fields }),
    create: () =>
      prisma.user.createMany({ data: [{ id: data.id, ...fields }], skipDuplicates: true }),
  });

  if ((await findTombstoned([data.id])).length > 0) {
    await prisma.user.deleteMany({ where: { id: data.id } });
  }
}

export async function upsertOrganization(data: OrganizationData): Promise<void> {
  // pre-check는 정리를 겸한다(상단 수렴 논증).
  if ((await findTombstoned([data.id])).length > 0) {
    await prisma.organization.deleteMany({ where: { id: data.id } });
    return;
  }

  const eventAt = new Date(data.updated_at);
  const fields = {
    name: data.name,
    slug: data.slug,
    imageUrl: data.image_url ?? null,
    clerkUpdatedAt: eventAt,
  };
  await guardedMirrorWrite({
    update: () =>
      prisma.organization.updateMany({
        where: { id: data.id, ...staleGuard(eventAt) },
        data: fields,
      }),
    create: () =>
      prisma.organization.createMany({ data: [{ id: data.id, ...fields }], skipDuplicates: true }),
  });

  if ((await findTombstoned([data.id])).length > 0) {
    await prisma.organization.deleteMany({ where: { id: data.id } });
  }
}

// 멤버십 upsert의 pre/post-check 공용 정리 — tombstone에 걸린 대상만 지운다
// (org 삭제는 membership을 cascade).
async function removeTombstonedMembershipRows(
  tombstoned: string[],
  ids: { membershipId: string; orgId: string; userId: string },
): Promise<void> {
  if (tombstoned.includes(ids.orgId)) {
    await prisma.organization.deleteMany({ where: { id: ids.orgId } });
  }
  if (tombstoned.includes(ids.userId)) {
    await prisma.user.deleteMany({ where: { id: ids.userId } });
  }
  if (tombstoned.includes(ids.membershipId)) {
    await prisma.membership.deleteMany({ where: { id: ids.membershipId } });
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
  const ids = { membershipId: data.id, orgId: org.id, userId };

  // pre-check는 정리를 겸한다(상단 수렴 논증).
  const pre = await findTombstoned([data.id, org.id, userId]);
  if (pre.length > 0) {
    await removeTombstonedMembershipRows(pre, ids);
    return;
  }

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

  const membershipFields = { id: data.id, role: data.role, clerkUpdatedAt: eventAt };
  await guardedMirrorWrite({
    update: () =>
      prisma.membership.updateMany({
        where: { orgId: org.id, userId, ...staleGuard(eventAt) },
        data: membershipFields,
      }),
    create: () =>
      prisma.membership.createMany({
        data: [{ orgId: org.id, userId, ...membershipFields }],
        skipDuplicates: true,
      }),
  });

  // 쓰는 사이 삭제가 커밋된 경우 — 방금 만든 행을 자가 정리.
  const post = await findTombstoned([data.id, org.id, userId]);
  if (post.length > 0) {
    await removeTombstonedMembershipRows(post, ids);
  }
}

// 삭제는 tombstone 기록과 행 삭제를 원자 커밋하고, 커밋 후 sweep으로 한 번 더 지운다.
// sweep이 필요한 이유: 트랜잭션의 DELETE(그 시점엔 행 없음)와 커밋 사이에 upsert의
// 쓰기·post-check가 통째로 끼어들 수 있다 — 그 경우 upsert의 쓰기 커밋은 반드시 sweep보다
// 앞서므로 sweep이 부활 행을 본다(상단 수렴 논증). createMany skip + deleteMany라 중복
// 배달도 멱등.

export async function deleteUser(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.clerkTombstone.createMany({ data: [{ id }], skipDuplicates: true }),
    // membership은 onDelete: Cascade, Note.authorId는 SetNull로 함께 처리된다.
    prisma.user.deleteMany({ where: { id } }),
  ]);
  await prisma.user.deleteMany({ where: { id } });
}

// 조직 삭제 시 같은 orgId의 Note는 FK Cascade로 함께 파기된다 (KAN-14에서 결정된
// 테넌트 데이터 수명 정책).
export async function deleteOrganization(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.clerkTombstone.createMany({ data: [{ id }], skipDuplicates: true }),
    prisma.organization.deleteMany({ where: { id } }),
  ]);
  await prisma.organization.deleteMany({ where: { id } });
}

export async function deleteMembership(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.clerkTombstone.createMany({ data: [{ id }], skipDuplicates: true }),
    prisma.membership.deleteMany({ where: { id } }),
  ]);
  await prisma.membership.deleteMany({ where: { id } });
}
