import 'server-only';

import { prisma } from '@/server/db';
import type { Prisma } from '@/server/generated/prisma/client';
import { visibleWhere } from '@/server/services/channels';

/**
 * 안읽음에서 빼는 것들.
 * - 답글은 세지 않는다. 채널 본문에 안 보이므로(KAN-30) 뱃지를 눌러 가도 찾을 수 없고,
 *   스레드에서 불렸다면 그건 알림 센터가 이미 맡는다(KAN-32).
 * - 내가 쓴 메시지는 세지 않는다. 내 말이 나에게 안읽음으로 돌아오면 안 된다.
 */
function countableWhere(userId: string): Prisma.ChatMessageWhereInput {
  return { parentId: null, authorId: { not: userId } };
}

/** 채널 id → 안읽음 수. 0인 채널은 아예 안 담는다. */
export type UnreadMap = Map<string, number>;

/**
 * 내가 참여한 채널들의 안읽음 수 (KAN-33).
 *
 * 참여하지 않은 공개 채널('둘러보기')은 세지 않는다 — 들어가 본 적도 없는 채널의 뱃지는
 * 신호가 아니라 소음이고, 기준선으로 삼을 참여 행조차 없다.
 *
 * 채널마다 기준선이 달라 조건을 OR로 묶어 groupBy 한 번으로 센다. 채널 수만큼 OR 가지가
 * 생기지만 각 가지가 (channelId, seq) 인덱스를 그대로 타고, 사이드바에 뜨는 채널 수가
 * 곧 상한이다.
 *
 * 기준선이 순번 하나로 정리된 것은 KAN-55다. 시각 두 종류(참여 시각 · 커서 시각)를
 * 비교하던 시절에는 그 둘이 서로 다른 앱 프로세스의 시계였고, 같은 ms 동률을 가르는
 * 보조 키 규칙도 가지마다 달랐다. 같은 채널의 순번끼리는 그냥 큰 쪽이 뒤다.
 */
export async function unreadCounts(orgId: string, userId: string): Promise<UnreadMap> {
  const [memberships, cursors] = await Promise.all([
    prisma.channelMember.findMany({
      // 참여 행만으로도 채널은 좁혀지지만, 테넌트 조회에는 예외 없이 orgId를 싣는다.
      where: { userId, channel: { orgId } },
      select: { channelId: true, joinedSeq: true },
    }),
    prisma.channelRead.findMany({
      where: { userId, orgId },
      select: { channelId: true, lastReadSeq: true },
    }),
  ]);
  if (memberships.length === 0) {
    return new Map();
  }

  const cursorByChannel = new Map(cursors.map((row) => [row.channelId, row.lastReadSeq]));
  const branches = memberships.map(({ channelId, joinedSeq }) => {
    // 둘 중 큰 쪽이 기준선이다. 커서가 참여 기준선보다 뒤일 때만 이기는 것은 재참여 때문이다
    // — 나갔다 들어오면 옛 커서가 남아 있는데(leaveChannel은 참여 행만 지운다), 그걸 그대로
    // 믿으면 내가 없던 동안의 대화가 통째로 안읽음으로 되살아난다.
    const baseline = Math.max(joinedSeq, cursorByChannel.get(channelId) ?? 0);
    return { channelId, seq: { gt: baseline } };
  });

  const grouped = await prisma.chatMessage.groupBy({
    by: ['channelId'],
    where: { orgId, ...countableWhere(userId), OR: branches },
    _count: { _all: true },
  });
  return new Map(grouped.map((row) => [row.channelId, row._count._all]));
}

/**
 * 읽음 커서를 이 메시지까지 올린다 (KAN-33).
 *
 * 접근할 수 없는 채널이거나 그 채널의 메시지가 아니면 false — 남의 채널 id로 내 커서를
 * 만들어 두는 경로를 막는다(그 자체로 위험하진 않지만 존재하지 않아야 할 행이다).
 *
 * **커서는 뒤로 가지 않는다.** 사용자가 위로 올려 옛 메시지를 보는 동안에도 요청이 나갈
 * 수 있고, 여러 탭·느린 응답이 섞이면 순서가 뒤집힌다. 뒤로 물러난 커서는 이미 읽은 것을
 * 안읽음으로 되살려 뱃지가 유령처럼 다시 뜬다.
 */
export async function markChannelRead(
  orgId: string,
  userId: string,
  channelId: string,
  messageId: string,
): Promise<boolean> {
  const message = await prisma.chatMessage.findFirst({
    where: {
      id: messageId,
      channelId,
      orgId,
      // parentId: null — 커서가 가리킬 수 있는 것은 채널 본문에 뜨는 메시지뿐이다
      // (countableWhere가 세는 것과 같은 집합). 답글도 같은 채널 카운터에서 순번을 받으므로
      // 답글 id로 커서를 세우면 아직 안 읽은 루트 메시지들을 건너뛰어 버린다.
      parentId: null,
      // 참여한 채널만. unreadCounts가 참여 채널만 세므로, 그렇지 않으면 둘러보기만 한
      // 채널마다 아무도 안 읽는 커서 행이 쌓인다(두 함수의 대상 집합을 맞춘다).
      channel: { ...visibleWhere(orgId, userId), members: { some: { userId } } },
    },
    select: { id: true, seq: true },
  });
  if (!message) {
    return false;
  }

  // 먼저 '더 앞으로 가는 경우'만 갱신해 본다. where에 전진 조건을 실었으므로 동시에 들어온
  // 옛 커서는 매칭 자체가 안 된다 — 읽고 비교하는 방식과 달리 경합이 생기지 않는다.
  const advance = () =>
    prisma.channelRead.updateMany({
      where: { channelId, userId, orgId, lastReadSeq: { lt: message.seq } },
      data: { lastReadSeq: message.seq },
    });

  if ((await advance()).count > 0) {
    return true;
  }

  // 갱신되지 않은 이유는 둘이다: 행이 없거나(첫 읽음), 이미 더 앞서 있거나.
  // 전자만 만든다 — createMany + skipDuplicates라 동시 첫 읽음에도 유니크 위반으로 죽지 않는다.
  const created = await prisma.channelRead.createMany({
    data: [{ channelId, userId, orgId, lastReadSeq: message.seq }],
    skipDuplicates: true,
  });
  if (created.count === 0) {
    // 방금 다른 요청이 첫 행을 만들었다. 그게 나보다 옛 메시지였다면 내 전진이 통째로
    // 사라지므로(skipDuplicates는 조용히 넘어간다) 한 번 더 밀어 본다. 이미 더 앞서
    // 있으면 where가 매칭되지 않아 아무 일도 일어나지 않는다.
    await advance();
  }
  return true;
}
