import { prisma } from '@/server/db';

// 테스트 간 격리. FK 의존 순서를 신경 쓰지 않도록 CASCADE로 한 번에 비운다.
//
// 테이블 목록을 손으로 적지 않고 DB에서 읽는 이유: 새 모델이 생겼을 때 목록에 추가하는
// 걸 잊으면 그 테이블만 조용히 안 지워져, 테스트가 서로의 데이터를 물려받는 유령
// 실패가 난다. 목록을 DB에서 가져오면 스키마가 늘어도 자동으로 따라온다.
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  // 식별자는 DB가 준 값이라 주입 위험이 없다. 대소문자 섞인 Prisma 테이블명이라 따옴표 필수.
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
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

// 각 워크스페이스의 기본 채널 — 메시지를 붙일 곳(KAN-28에서 ChatMessage가 채널에 매달렸다).
export const CHANNEL_A = 'chan_a';
export const CHANNEL_B = 'chan_b';

export async function seedChannels(): Promise<void> {
  await prisma.channel.createMany({
    data: [
      { id: CHANNEL_A, orgId: ORG_A, name: '일반', isDefault: true },
      { id: CHANNEL_B, orgId: ORG_B, name: '일반', isDefault: true },
    ],
  });
}

/** 조직 멤버십 미러 — 채널 초대 후보 조회처럼 Membership을 보는 서비스가 쓴다. */
export async function seedMemberships(): Promise<void> {
  await prisma.membership.createMany({
    data: [
      { id: 'mem_a_owner', orgId: ORG_A, userId: USER_OWNER, role: 'org:admin' },
      { id: 'mem_a_other', orgId: ORG_A, userId: USER_OTHER, role: 'org:member' },
      { id: 'mem_b_other', orgId: ORG_B, userId: USER_OTHER, role: 'org:member' },
    ],
  });
}
