import 'server-only';

import { prisma } from '@/server/db';
import type { ChatMessage, User } from '@/server/generated/prisma/client';
import { visibleWhere } from '@/server/services/channels';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { userSkeleton } from '@/server/services/skeleton';
import { displayName } from '@/server/services/user-display';
import type { ChatMessageView } from '@/features/chat/types';

// 작성자 표시는 Clerk 미러 User에서 읽는다 — webhook 동기화 전이면 id로 대체.
// ChatMessage.authorId에 FK를 안 두는 이유이기도 하다(전송이 동기화 순서에 안 묶이게).
function toView(message: ChatMessage, author: User | null): ChatMessageView {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    authorName: author ? displayName(author) : message.authorId,
    authorImageUrl: author?.imageUrl ?? null,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

export const MESSAGE_PAGE_SIZE = 50;

/**
 * 한 페이지. messages는 언제나 오래된 것부터고, hasMore는 이 페이지보다 더 위(과거)에
 * 메시지가 남아 있는지다 — 클라이언트가 '더 불러오기'를 띄울지 정하는 유일한 근거다.
 * 다음 커서는 messages[0].id라 따로 내려보내지 않는다(클라이언트가 이미 들고 있다).
 */
export interface MessagePage {
  messages: ChatMessageView[];
  hasMore: boolean;
}

/**
 * 채널 메시지 한 페이지를 오래된 것부터 반환한다(KAN-29).
 *
 * before가 없으면 최신 페이지, 있으면 그 메시지보다 과거의 페이지다. OFFSET이 아니라
 * (createdAt, id) 키셋 커서를 쓴다 — OFFSET은 뒤로 갈수록 앞 행을 전부 훑고, 읽는 도중
 * 새 메시지가 들어오면 페이지 경계가 밀려 같은 메시지를 두 번 보게 된다.
 * @@index([channelId, createdAt])를 그대로 타므로 깊은 페이지도 비용이 일정하다.
 *
 * 채널 접근 권한을 where에 실어 조회 자체가 매칭되지 않게 한다 — 남의 워크스페이스나
 * 참여하지 않은 비공개 채널의 id를 알아도 빈 배열만 나온다(쿼리 수준 격리).
 */
export async function listMessages(
  orgId: string,
  userId: string,
  channelId: string,
  before?: string,
): Promise<MessagePage> {
  const scope = { orgId, channel: { id: channelId, ...visibleWhere(orgId, userId) } };

  // 커서는 메시지 id 하나만 받고 기준 시각은 서버가 되찾는다 — 클라이언트가 보낸
  // 타임스탬프를 믿으면 그걸 조작해 페이지 경계를 임의로 옮길 수 있다. 조회 자체를 같은
  // 스코프로 걸어, 남의 채널 메시지 id를 커서로 밀어 넣어도 앵커를 얻지 못한다.
  const anchor = before
    ? await prisma.chatMessage.findFirst({
        where: { id: before, ...scope },
        select: { id: true, createdAt: true },
      })
    : null;
  // 커서를 줬는데 못 찾았다면(잘못된 id·이미 지워진 메시지) 더 줄 것이 없다고 답한다.
  if (before && !anchor) {
    return { messages: [], hasMore: false };
  }

  const rows = await prisma.chatMessage.findMany({
    where: {
      ...scope,
      // 키셋 조건 — 커서보다 엄격히 과거인 행만. createdAt 동률(같은 ms 연속 전송)은
      // id로 갈라 커서가 자기 자신이나 동률 이웃을 다시 집지 않게 한다.
      ...(anchor
        ? {
            OR: [
              { createdAt: { lt: anchor.createdAt } },
              { createdAt: anchor.createdAt, id: { lt: anchor.id } },
            ],
          }
        : {}),
    },
    // 정렬 키는 키셋 조건과 정확히 같은 (createdAt, id)여야 한다.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // 한 건 더 떠서 '더 있는지'를 별도 count 없이 판정한다.
    take: MESSAGE_PAGE_SIZE + 1,
  });

  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const messages = (hasMore ? rows.slice(0, MESSAGE_PAGE_SIZE) : rows).reverse();

  const authorIds = [...new Set(messages.map((message) => message.authorId))];
  const authors = await prisma.user.findMany({ where: { id: { in: authorIds } } });
  const authorById = new Map(authors.map((author) => [author.id, author]));

  return {
    messages: messages.map((message) => toView(message, authorById.get(message.authorId) ?? null)),
    hasMore,
  };
}

/**
 * 전송 결과. joined는 이번 전송이 슬랙식 자동 참여를 일으켰는지 — 액션이 이때만 채널
 * 목록을 재검증한다. 없으면 사이드바가 그 채널을 계속 '둘러보기'에 둔 채 굳는다
 * (목록은 레이아웃이 그리는데 레이아웃은 페이지 이동만으로 다시 안 불린다).
 */
export interface SendResult {
  message: ChatMessageView;
  joined: boolean;
}

/** 접근할 수 없는 채널이면 null — 액션이 '채널을 찾을 수 없습니다'로 바꾼다. */
export async function createMessage(
  orgId: string,
  authorId: string,
  channelId: string,
  body: string,
): Promise<SendResult | null> {
  // 대상 채널이 이 워크스페이스의 것이고 내가 접근할 수 있는지 — 전송의 테넌트 경계다.
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, ...visibleWhere(orgId, authorId) },
    select: { id: true },
  });
  if (!channel) {
    return null;
  }

  // 삭제된 워크스페이스·사용자로의 쓰기를 막는다 — 세션은 조직/계정이 지워진 뒤에도 토큰
  // 만료까지 살아 있어서, 그 사이 전송이 org 스켈레톤을 부활시키고 메시지를 영구 축적할 수
  // 있다(KAN-19). notes.createNote·board와 같은 pre/post 이중 확인 — 확인과 쓰기 사이에
  // 삭제가 커밋되면 cascade는 이미 끝난 뒤라 pre-check만으로는 부족하다.
  await assertNotTombstoned([orgId, authorId]);

  // org 스켈레톤은 여기서 만들지 않는다 — 위에서 채널 행을 찾았다는 것이 곧 org 미러가
  // 있다는 증명이다(Channel.orgId FK). 워크스페이스 부트스트랩은 ensureDefaultChannel이
  // 맡는다. 여기서 org를 create-if-absent 하면 '방금 삭제된 조직'을 되살리기만 한다.
  //
  // 두 번째 문장은 슬랙식 자동 참여다 — 둘러보던 공개 채널에 말을 걸면 '내 채널'로 들어온다.
  // 조건 분기 없이 항상 실행한다: 이미 참여 중이면(비공개 채널은 참여자만 여기 도달한다)
  // ON CONFLICT DO NOTHING으로 아무 일도 일어나지 않는다.
  // userSkeleton이 필요한 것도 이 문장 때문이다 — ChannelMember.userId에는 FK가 있어,
  // user.created 웹훅이 늦은 새 멤버의 첫 발언이 FK 위반으로 죽지 않게 한다.
  const [, join, message] = await prisma.$transaction([
    userSkeleton(authorId),
    prisma.channelMember.createMany({ data: [{ channelId, userId: authorId }], skipDuplicates: true }),
    prisma.chatMessage.create({ data: { orgId, channelId, authorId, body } }),
  ]);
  const joined = join.count > 0;

  // post-check — 방금 되살렸을 수 있는 org·user를 자가 정리한다. org tombstone이면 cascade로
  // 메시지까지 지워지지만, user tombstone 경로에서는 메시지가 남으므로 명시적으로 지운다.
  // 참여 행은 이번에 만든 것만 되돌린다(원래 멤버였다면 건드릴 이유가 없다).
  await assertNotTombstoned([orgId, authorId], async () => {
    await prisma.chatMessage.deleteMany({ where: { id: message.id } });
    if (joined) {
      await prisma.channelMember.deleteMany({ where: { channelId, userId: authorId } });
    }
  });

  const author = await prisma.user.findUnique({ where: { id: authorId } });
  return { message: toView(message, author), joined };
}
