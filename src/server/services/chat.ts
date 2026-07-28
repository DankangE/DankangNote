import 'server-only';

import { prisma } from '@/server/db';
import type { ChatMessage, User } from '@/server/generated/prisma/client';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
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
  // 삭제된 워크스페이스·사용자로의 쓰기를 막는다 — 세션은 조직/계정이 지워진 뒤에도 토큰
  // 만료까지 살아 있어서, 그 사이 전송이 org 스켈레톤을 부활시키고 메시지를 영구 축적할 수
  // 있다(KAN-19). notes.createNote·board와 같은 pre/post 이중 확인 — 확인과 쓰기 사이에
  // 삭제가 커밋되면 cascade는 이미 끝난 뒤라 pre-check만으로는 부족하다.
  await assertNotTombstoned([orgId, authorId]);

  // orgId FK(Cascade)가 생겼으므로 org 미러 행이 반드시 있어야 한다. webhook이 아직 안
  // 채웠을 수 있어 스켈레톤 생성과 한 트랜잭션으로 묶는다(notes·board와 동일 패턴).
  // 실제 name 등은 organization.* webhook이 나중에 교정한다.
  const [, message] = await prisma.$transaction([
    prisma.organization.createMany({ data: [{ id: orgId, name: orgId }], skipDuplicates: true }),
    prisma.chatMessage.create({ data: { orgId, authorId, body } }),
  ]);

  // post-check — 방금 되살렸을 수 있는 org를 자가 정리한다. org tombstone이면 cascade로
  // 메시지까지 지워지지만, user tombstone 경로에서는 메시지가 남으므로 명시적으로 지운다.
  await assertNotTombstoned([orgId, authorId], async () => {
    await prisma.chatMessage.deleteMany({ where: { id: message.id } });
  });

  const author = await prisma.user.findUnique({ where: { id: authorId } });
  return toView(message, author);
}
