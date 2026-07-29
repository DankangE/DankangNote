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

const MESSAGE_PAGE_SIZE = 50;

/**
 * 채널의 최근 N개를 오래된 것부터 반환. 페이지네이션은 KAN-29 스코프다.
 *
 * 채널 접근 권한을 where에 실어 조회 자체가 매칭되지 않게 한다 — 남의 워크스페이스나
 * 참여하지 않은 비공개 채널의 id를 알아도 빈 배열만 나온다(쿼리 수준 격리).
 */
export async function listMessages(
  orgId: string,
  userId: string,
  channelId: string,
): Promise<ChatMessageView[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { orgId, channel: { id: channelId, ...visibleWhere(orgId, userId) } },
    // createdAt 동률(같은 ms 연속 전송)은 id 타이브레이커로 순서 고정.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MESSAGE_PAGE_SIZE,
  });
  messages.reverse();

  const authorIds = [...new Set(messages.map((message) => message.authorId))];
  const authors = await prisma.user.findMany({ where: { id: { in: authorIds } } });
  const authorById = new Map(authors.map((author) => [author.id, author]));

  return messages.map((message) => toView(message, authorById.get(message.authorId) ?? null));
}

/** 접근할 수 없는 채널이면 null — 액션이 '채널을 찾을 수 없습니다'로 바꾼다. */
export async function createMessage(
  orgId: string,
  authorId: string,
  channelId: string,
  body: string,
): Promise<ChatMessageView | null> {
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
  const [, , message] = await prisma.$transaction([
    userSkeleton(authorId),
    prisma.channelMember.createMany({ data: [{ channelId, userId: authorId }], skipDuplicates: true }),
    prisma.chatMessage.create({ data: { orgId, channelId, authorId, body } }),
  ]);

  // post-check — 방금 되살렸을 수 있는 org·user를 자가 정리한다. org tombstone이면 cascade로
  // 메시지까지 지워지지만, user tombstone 경로에서는 메시지가 남으므로 명시적으로 지운다.
  await assertNotTombstoned([orgId, authorId], async () => {
    await prisma.chatMessage.deleteMany({ where: { id: message.id } });
    await prisma.channelMember.deleteMany({ where: { channelId, userId: authorId } });
  });

  const author = await prisma.user.findUnique({ where: { id: authorId } });
  return toView(message, author);
}
