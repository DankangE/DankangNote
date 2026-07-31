import 'server-only';

import { prisma } from '@/server/db';
import type { Prisma } from '@/server/generated/prisma/client';
import { visibleWhere } from '@/server/services/channels';

/**
 * 안읽음 판정의 기준선 하나. cursor는 마지막으로 읽은 (createdAt, id),
 * 없으면 참여 시각(그 이전 이력은 애초에 '안 읽은 것'이 아니다).
 */
type Baseline =
  | { kind: 'cursor'; at: Date; id: string }
  | { kind: 'joined'; at: Date };

/**
 * 이 기준선보다 **뒤에 온** 메시지의 조건.
 *
 * 커서가 있으면 (createdAt, id) 키셋이다 — 시각만 비교하면 같은 ms에 들어온 메시지가
 * 경계에서 빠지거나 두 번 세어진다(KAN-29의 페이지 커서와 같은 이유).
 * OR을 AND로 한 겹 감싸는 것도 같은 이유다: 최상위에 두면 나중에 누가 다른 OR 조건을
 * 더했을 때 둘이 조용히 서로를 덮어쓴다.
 */
function afterBaseline(baseline: Baseline): Prisma.ChatMessageWhereInput {
  if (baseline.kind === 'joined') {
    // gte인 이유: 참여 행과 **정확히 같은 ms**에 들어온 메시지는 참여 직후에 온 것이다.
    // gt로 두면 그 한 건이 영영 안 세어진다(커서 가지는 id로 동률을 가르는데 여기만
    // 비대칭이면 규칙이 갈린다).
    return { createdAt: { gte: baseline.at } };
  }
  return {
    // 인덱스 시작 경계. 아래 키셋만으로는 (channelId, createdAt) 인덱스의 출발점을 못 잡는다.
    createdAt: { gte: baseline.at },
    AND: [
      {
        OR: [
          { createdAt: { gt: baseline.at } },
          { createdAt: baseline.at, id: { gt: baseline.id } },
        ],
      },
    ],
  };
}

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
 * 신호가 아니라 소음이고, 기준선으로 삼을 참여 시각조차 없다.
 *
 * 채널마다 기준선이 달라 조건을 OR로 묶어 groupBy 한 번으로 센다. 채널 수만큼 OR 가지가
 * 생기지만 각 가지가 (channelId, createdAt) 인덱스를 그대로 타고, 사이드바에 뜨는 채널
 * 수가 곧 상한이다.
 */
export async function unreadCounts(orgId: string, userId: string): Promise<UnreadMap> {
  const [memberships, cursors] = await Promise.all([
    prisma.channelMember.findMany({
      // 참여 행만으로도 채널은 좁혀지지만, 테넌트 조회에는 예외 없이 orgId를 싣는다.
      where: { userId, channel: { orgId } },
      select: { channelId: true, createdAt: true },
    }),
    prisma.channelRead.findMany({
      where: { userId, orgId },
      select: { channelId: true, lastReadAt: true, lastReadId: true },
    }),
  ]);
  if (memberships.length === 0) {
    return new Map();
  }

  const cursorByChannel = new Map(cursors.map((row) => [row.channelId, row]));
  const branches = memberships.map(({ channelId, createdAt }) => {
    const cursor = cursorByChannel.get(channelId);
    // 커서가 참여 시각보다 **뒤일 때만** 커서를 쓴다. 나갔다 다시 들어오면 옛 커서가
    // 남아 있는데(leaveChannel은 참여 행만 지운다), 그걸 그대로 믿으면 내가 없던 동안의
    // 대화가 통째로 안읽음으로 되살아난다 — '참여 이전 이력은 안읽음이 아니다'라는
    // 규칙이 재참여 경로에서만 깨지는 것이다.
    const baseline: Baseline =
      cursor && cursor.lastReadAt >= createdAt
        ? { kind: 'cursor', at: cursor.lastReadAt, id: cursor.lastReadId }
        : { kind: 'joined', at: createdAt };
    return { channelId, ...afterBaseline(baseline) };
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
      channel: visibleWhere(orgId, userId),
    },
    select: { id: true, createdAt: true },
  });
  if (!message) {
    return false;
  }

  // 먼저 '더 앞으로 가는 경우'만 갱신해 본다. where에 전진 조건을 실었으므로 동시에 들어온
  // 옛 커서는 매칭 자체가 안 된다 — 읽고 비교하는 방식과 달리 경합이 생기지 않는다.
  const advance = () =>
    prisma.channelRead.updateMany({
      where: {
        channelId,
        userId,
        orgId,
        OR: [
          { lastReadAt: { lt: message.createdAt } },
          { lastReadAt: message.createdAt, lastReadId: { lt: message.id } },
        ],
      },
      data: { lastReadAt: message.createdAt, lastReadId: message.id },
    });

  if ((await advance()).count > 0) {
    return true;
  }

  // 갱신되지 않은 이유는 둘이다: 행이 없거나(첫 읽음), 이미 더 앞서 있거나.
  // 전자만 만든다 — createMany + skipDuplicates라 동시 첫 읽음에도 유니크 위반으로 죽지 않는다.
  const created = await prisma.channelRead.createMany({
    data: [{ channelId, userId, orgId, lastReadAt: message.createdAt, lastReadId: message.id }],
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
