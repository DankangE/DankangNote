import 'server-only';

import type {
  OrganizationMembershipWebhookEvent,
  OrganizationWebhookEvent,
  UserWebhookEvent,
} from '@clerk/nextjs/webhooks';

import { prisma } from '@/server/db';

// Clerk가 보내는 payload(UserJSON 등)는 webhooks 엔트리에서 직접 export되지 않는다.
// 대신 export되는 판별 유니온에서 upsert 이벤트의 data 타입만 파생한다
// (단순 Extract는 멤버 type이 'created'|'updated' 유니온이라 실패 → deleted를 Exclude).
type UserData = Exclude<UserWebhookEvent, { type: 'user.deleted' }>['data'];
type OrganizationData = Exclude<OrganizationWebhookEvent, { type: 'organization.deleted' }>['data'];
type MembershipData = OrganizationMembershipWebhookEvent['data'];

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
  const fields = {
    email: primaryEmail(data),
    firstName: data.first_name,
    lastName: data.last_name,
    imageUrl: data.image_url,
  };
  await prisma.user.upsert({
    where: { id: data.id },
    create: { id: data.id, ...fields },
    update: fields,
  });
}

export async function upsertOrganization(data: OrganizationData): Promise<void> {
  const fields = {
    name: data.name,
    slug: data.slug,
    imageUrl: data.image_url ?? null,
  };
  await prisma.organization.upsert({
    where: { id: data.id },
    create: { id: data.id, ...fields },
    update: fields,
  });
}

// 멤버십 payload는 organization·public_user_data를 임베드한다. org·user를 함께 upsert해
// webhook 배달 순서(멤버십이 org/user 이벤트보다 먼저 도착)와 무관하게 FK가 성립하도록
// 세 upsert를 한 트랜잭션으로 묶는다.
export async function upsertMembership(data: MembershipData): Promise<void> {
  const org = data.organization;
  const pud = data.public_user_data;
  const userId = pud.user_id;

  await prisma.$transaction([
    prisma.organization.upsert({
      where: { id: org.id },
      create: { id: org.id, name: org.name, slug: org.slug, imageUrl: org.image_url ?? null },
      update: { name: org.name, slug: org.slug, imageUrl: org.image_url ?? null },
    }),
    prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: emailFromIdentifier(pud.identifier),
        firstName: pud.first_name,
        lastName: pud.last_name,
        imageUrl: pud.image_url,
      },
      // 이메일 등 상세는 user.* 이벤트가 채운다 — 멤버십 이벤트가 그 값을 덮어쓰지 않도록 update는 최소화.
      update: {
        firstName: pud.first_name,
        lastName: pud.last_name,
        imageUrl: pud.image_url,
      },
    }),
    prisma.membership.upsert({
      where: { id: data.id },
      create: { id: data.id, orgId: org.id, userId, role: data.role },
      update: { orgId: org.id, userId, role: data.role },
    }),
  ]);
}

// delete 계열은 deleteMany로 멱등 처리(중복 배달·미존재도 안전). 멤버십은 onDelete: Cascade로 함께 삭제된다.
export async function deleteUser(id: string): Promise<void> {
  await prisma.user.deleteMany({ where: { id } });
}

export async function deleteOrganization(id: string): Promise<void> {
  await prisma.organization.deleteMany({ where: { id } });
}

export async function deleteMembership(id: string): Promise<void> {
  await prisma.membership.deleteMany({ where: { id } });
}
