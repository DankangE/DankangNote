import 'server-only';

import { prisma } from '@/server/db';
import type { Prisma } from '@/server/generated/prisma/client';
import { visibleWhere } from '@/server/services/channels';
import { displayName } from '@/server/services/user-display';
import {
  CHANNEL_MENTION,
  spanMatches,
  type MentionKind,
  type MentionSpan,
} from '@/features/chat/mentions';

/**
 * 보낸 메시지의 멘션을 확정한다 (KAN-32).
 *
 * 클라이언트가 주장한 스팬을 **그대로 믿지 않는다**. 두 가지를 서버에서 다시 본다:
 * ① 대상이 이 워크스페이스의 멤버인가 — 아니면 남의 org 사람에게 알림을 밀어 넣을 수 있다.
 * ② 본문의 그 구간이 정말 그 사람의 이름으로 적혀 있는가 — 아니면 아무 본문에나 임의의
 *    userId를 실어 조직 전체를 호출하는 알림 스팸이 된다.
 * 이름은 여기서 미러를 다시 읽어 만든다(클라이언트가 보낸 라벨은 쓰지 않는다).
 *
 * 통과한 것만 돌려주고, 나머지는 조용히 버린다 — 전송 자체를 실패시키면 이름이 방금 바뀐
 * 사람을 멘션했다는 이유로 메시지를 못 보내게 된다.
 */
export async function resolveMentions(
  orgId: string,
  body: string,
  claimed: MentionSpan[],
): Promise<MentionSpan[]> {
  if (claimed.length === 0) {
    return [];
  }

  const userIds = [...new Set(claimed.flatMap((span) => (span.userId ? [span.userId] : [])))];
  // 조직 멤버만 멘션할 수 있다. Membership 미러를 '후보 목록'으로 쓰는 것은
  // channel-members.inviteToChannel과 같은 판단이다 — 실제 게이트는 알림을 여는 쪽에서
  // 자기 세션의 orgId로 다시 걸린다.
  const members =
    userIds.length > 0
      ? await prisma.membership.findMany({
          where: { orgId, userId: { in: userIds } },
          select: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        })
      : [];
  const labelById = new Map(members.map(({ user }) => [user.id, displayName(user)]));

  return claimed.filter((span) => {
    const label = span.kind === 'channel' ? CHANNEL_MENTION : labelById.get(span.userId ?? '');
    return label !== undefined && spanMatches(body, span, label);
  });
}

/**
 * 확정된 멘션에서 알림 받을 사람을 정한다.
 *
 * @channel은 그 채널 참여자 전체다 — 공개 채널이라도 '참여자'로 한정한다. 조직 전체로
 * 넓히면 둘러보기만 하던 채널의 @channel이 모두를 부르게 되고, 그건 알림을 끄게 만든다.
 * 보낸 사람 자신은 언제나 뺀다(자기 말에 자기가 호출되지 않는다).
 */
export async function mentionRecipients(
  channelId: string,
  authorId: string,
  spans: MentionSpan[],
): Promise<{ userId: string; kind: MentionKind }[]> {
  const byUser = new Map<string, MentionKind>();

  if (spans.some((span) => span.kind === 'channel')) {
    const members = await prisma.channelMember.findMany({
      where: { channelId },
      select: { userId: true },
    });
    for (const { userId } of members) {
      byUser.set(userId, 'channel');
    }
  }
  // 개인 멘션이 @channel을 덮어쓴다 — 직접 불린 것이 더 강한 신호라 알림 문구도 그쪽이다.
  for (const span of spans) {
    if (span.kind === 'user' && span.userId) {
      byUser.set(span.userId, 'user');
    }
  }

  byUser.delete(authorId);
  return [...byUser].map(([userId, kind]) => ({ userId, kind }));
}

/** 알림 목록 한 줄. 클릭하면 그 채널로 가고, 답글이면 스레드까지 연다. */
export interface NotificationView {
  id: string;
  kind: string;
  channelId: string;
  channelName: string;
  messageId: string;
  /** 스레드 답글이면 루트 id — 알림에서 바로 그 스레드를 연다. */
  threadRootId: string | null;
  actorName: string;
  actorImageUrl: string | null;
  /** 미리보기용 본문 일부. */
  excerpt: string;
  read: boolean;
  createdAt: string;
}

const EXCERPT_LIMIT = 140;

export const NOTIFICATION_PAGE_SIZE = 20;

/**
 * 내 알림 최신순 한 페이지.
 *
 * 알림 발췌는 메시지 본문의 일부다. 그래서 **지금 볼 수 있는 채널의 알림만** 돌려준다 —
 * 비공개 채널에서 빠진 뒤에도 발췌가 계속 보이면 그게 곧 유출이다. 못 보게 된 알림은
 * 목록에서 조용히 사라지고, 안읽음 수도 같은 기준으로 센다.
 *
 * 커서는 메시지 이력과 같은 (createdAt, id) 키셋이다(KAN-29). 알림 id 하나만 받고 기준
 * 시각은 서버가 되찾는다 — 클라이언트가 보낸 시각을 믿으면 그걸 조작해 페이지 경계를
 * 옮길 수 있고, 같은 ms에 여러 건이 생기는 @channel에서는 타임스탬프만으로는 경계에서
 * 알림이 건너뛰거나 두 번 나온다.
 */
export async function listNotifications(
  orgId: string,
  userId: string,
  before?: string,
): Promise<{ notifications: NotificationView[]; hasMore: boolean }> {
  const scope = visibleNotificationWhere(orgId, userId);
  const anchor = before
    ? await prisma.notification.findFirst({
        where: { id: before, ...scope },
        select: { id: true, createdAt: true },
      })
    : null;
  // 위조된 커서·못 보게 된 채널의 커서는 fail-closed로 닫는다(메시지 이력과 같은 판단).
  if (before && !anchor) {
    return { notifications: [], hasMore: false };
  }

  const rows = await prisma.notification.findMany({
    where: {
      ...scope,
      ...(anchor
        ? {
            // 인덱스 시작 경계 + 키셋. createdAt 동률(@channel 한 번에 여러 건)은 id로 가른다.
            createdAt: { lte: anchor.createdAt },
            AND: [
              {
                OR: [
                  { createdAt: { lt: anchor.createdAt } },
                  { createdAt: anchor.createdAt, id: { lt: anchor.id } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: NOTIFICATION_PAGE_SIZE + 1,
    include: {
      channel: { select: { name: true } },
      message: { select: { body: true, parentId: true } },
    },
  });

  const hasMore = rows.length > NOTIFICATION_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, NOTIFICATION_PAGE_SIZE) : rows;

  const actorIds = [...new Set(page.map((row) => row.actorId))];
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } } });
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));

  return {
    hasMore,
    notifications: page.map((row) => {
      const actor = actorById.get(row.actorId);
      return {
        id: row.id,
        kind: row.kind,
        channelId: row.channelId,
        channelName: row.channel.name,
        messageId: row.messageId,
        threadRootId: row.message.parentId,
        actorName: actor ? displayName(actor) : row.actorId,
        actorImageUrl: actor?.imageUrl ?? null,
        excerpt: row.message.body.slice(0, EXCERPT_LIMIT),
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      };
    }),
  };
}

/**
 * 목록·카운트·읽음 처리가 공유하는 단 하나의 where. 세 곳이 갈리면 '뱃지에는 있는데
 * 열면 없는' 알림이 생긴다 — 채널 가시성 조건이 특히 그렇다.
 */
function visibleNotificationWhere(orgId: string, userId: string): Prisma.NotificationWhereInput {
  return {
    orgId,
    userId,
    // 지금 볼 수 있는 채널의 것만. 규칙을 여기 다시 적지 않고 채널의 판정을 그대로 끼운다 —
    // 알림은 메시지 발췌를 들고 있어서, 두 판정이 갈리는 순간 그 차이가 곧 유출 경로다.
    channel: visibleWhere(orgId, userId),
  };
}

/** 안읽음 수 — 뱃지의 유일한 근거. 목록과 같은 where를 쓴다. */
export function unreadCount(orgId: string, userId: string): Promise<number> {
  return prisma.notification.count({
    where: { ...visibleNotificationWhere(orgId, userId), readAt: null },
  });
}

/**
 * 읽음 처리. ids를 주면 그것만, 없으면 지금 보이는 안읽음 전부.
 * 단건 update가 아니라 updateMany인 것은 남의 알림 id를 알아도 매칭 자체가 안 되게
 * 하기 위해서다(backend.md의 격리 규칙).
 */
export async function markRead(
  orgId: string,
  userId: string,
  ids?: string[],
): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: {
      ...visibleNotificationWhere(orgId, userId),
      readAt: null,
      ...(ids ? { id: { in: ids } } : {}),
    },
    data: { readAt: new Date() },
  });
  return count;
}
