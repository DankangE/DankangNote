import { prisma } from '@/server/db';

// 테스트 간 격리. FK 의존 순서를 신경 쓰지 않도록 CASCADE로 한 번에 비운다.
// (Membership·Note·Board*·ChatMessage는 모두 Organization/User에 매달려 있다.)
const TABLES = [
  'ChatMessage',
  'BoardCard',
  'BoardColumn',
  'Note',
  'Membership',
  'ClerkTombstone',
  'User',
  'Organization',
];

export async function resetDatabase(): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

// 테스트에서 쓰는 두 워크스페이스 — "내 org"와 "남의 org".
export const ORG_A = 'org_a';
export const ORG_B = 'org_b';

export const USER_OWNER = 'user_owner';
export const USER_OTHER = 'user_other';
export const USER_ADMIN = 'user_admin';

/** 두 조직과 사용자 미러를 만들어 둔다(웹훅이 이미 동기화한 상태를 흉내). */
export async function seedTenants(): Promise<void> {
  await prisma.organization.createMany({
    data: [
      { id: ORG_A, name: '워크스페이스 A' },
      { id: ORG_B, name: '워크스페이스 B' },
    ],
  });
  await prisma.user.createMany({
    data: [{ id: USER_OWNER }, { id: USER_OTHER }, { id: USER_ADMIN }],
  });
}
