import 'server-only';

import { prisma } from '@/server/db';
import type { ChatMessage, User } from '@/server/generated/prisma/client';
import type { ChatMessageView } from '@/features/chat/types';

// 작성자 표시는 Clerk 미러 User에서 읽는다 — webhook 동기화 전이면 id로 대체.
// ChatMessage.authorId에 FK를 안 두는 이유이기도 하다(전송이 동기화 순서에 안 묶이게).
function toView(message: ChatMessage, author: User | null): ChatMessageView {
  const name = author
    ? [author.firstName, author.lastName].filter(Boolean).join(' ') || author.email || author.id
    : message.authorId;
  return {
    id: message.id,
    authorId: message.authorId,
    authorName: name,
    authorImageUrl: author?.imageUrl ?? null,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

const MESSAGE_PAGE_SIZE = 50;

// 최근 N개를 오래된 것부터 반환. 페이지네이션은 MVP 스코프 제외(KAN-15).
export async function listMessages(orgId: string): Promise<ChatMessageView[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { orgId },
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

export async function createMessage(
  orgId: string,
  authorId: string,
  body: string,
): Promise<ChatMessageView> {
  const message = await prisma.chatMessage.create({ data: { orgId, authorId, body } });
  const author = await prisma.user.findUnique({ where: { id: authorId } });
  return toView(message, author);
}
