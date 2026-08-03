import { prisma } from '@/server/db';
import type { ChatMessage } from '@/server/generated/prisma/client';

// 테스트 간 격리. FK 의존 순서를 신경 쓰지 않도록 CASCADE로 한 번에 비운다.
//
// ORDER BY가 있는 이유: 순서가 흔들리면 두 프로세스가 서로 다른 순서로 락을 잡아
// TRUNCATE끼리 데드락이 난다(같은 체크아웃에서 세션을 병행할 때 실제로 발생).
//
// 테이블 목록을 손으로 적지 않고 DB에서 읽는 이유: 새 모델이 생겼을 때 목록에 추가하는
// 걸 잊으면 그 테이블만 조용히 안 지워져, 테스트가 서로의 데이터를 물려받는 유령
// 실패가 난다. 목록을 DB에서 가져오면 스키마가 늘어도 자동으로 따라온다.
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
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

/**
 * 서비스를 거치지 않고 메시지를 심는다 (KAN-55).
 *
 * seq를 손으로 적지 않고 채널 카운터에서 이어 받는 이유가 둘이다. ① (channelId, seq)가
 * unique라 손으로 적으면 기존 행과 부딪힌다. ② 카운터를 올려 두지 않으면 뒤이은 실제
 * 전송이 같은 번호를 받아 죽는다 — 시드와 서비스가 같은 번호 매기기를 공유해야 한다.
 *
 * createdAt은 표시용이라 호출부가 원하면 그대로 넣는다. 정렬은 이제 그 값과 무관하다.
 */
export async function seedMessages(
  rows: Array<{
    id?: string;
    orgId: string;
    channelId: string;
    authorId: string;
    body: string;
    parentId?: string;
    createdAt?: Date;
  }>,
): Promise<ChatMessage[]> {
  const created: ChatMessage[] = [];
  for (const row of rows) {
    const [counter] = await prisma.$queryRaw<{ messageSeq: number }[]>`
      UPDATE "Channel" SET "messageSeq" = "messageSeq" + 1
      WHERE "id" = ${row.channelId}
      RETURNING "messageSeq"
    `;
    if (!counter) {
      throw new Error(`시드 대상 채널이 없다: ${row.channelId}`);
    }
    created.push(await prisma.chatMessage.create({ data: { ...row, seq: counter.messageSeq } }));
  }
  return created;
}
