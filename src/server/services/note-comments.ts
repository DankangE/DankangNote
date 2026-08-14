import 'server-only';

import { prisma } from '@/server/db';
import { Prisma } from '@/server/generated/prisma/client';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { orgSkeleton, userSkeleton } from '@/server/services/skeleton';
import type { NoteActor } from '@/server/services/notes';

// 인라인 코멘트 (KAN-40) — 본문의 텍스트 범위에 달린 대화.
//
// 앵커는 여기 없다. 범위는 본문 JSON의 comment 마크가 들고 있고(features/notes/comments.ts),
// 이 계층은 '그 id에 무슨 대화가 달려 있는가'만 안다. 둘을 잇는 유일한 규칙: **스레드가
// 먼저 만들어지고 그 id로 마크가 찍힌다.** 반대로 하면 저장 정규화가 가리킬 곳 없는 마크로
// 보고 떨군다(note-sanitize.ts).

const AUTHOR_SELECT = { id: true, firstName: true, lastName: true, email: true } as const;

const COMMENT_SELECT = {
  id: true,
  body: true,
  authorId: true,
  createdAt: true,
  author: { select: AUTHOR_SELECT },
} as const;

const THREAD_SELECT = {
  id: true,
  noteId: true,
  authorId: true,
  resolvedAt: true,
  resolvedBy: true,
  createdAt: true,
  comments: { select: COMMENT_SELECT, orderBy: { createdAt: 'asc' } },
} as const;

export type NoteCommentThreadView = Prisma.NoteCommentThreadGetPayload<{
  select: typeof THREAD_SELECT;
}>;

/**
 * 이 노트의 코멘트 스레드 전부 (해결된 것 포함 — 화면이 접어서 보여준다).
 *
 * 노트는 org 전체 공개라 판정이 'org 안에 있는가' 하나다(getNote와 같은 근거). 노트 존재
 * 확인을 따로 하지 않는 이유: 없는 노트면 결과가 빈 배열이고, 그건 '없다'와 구분할 필요가
 * 없다 — 오히려 구분하면 남의 org에 그 id의 노트가 있는지 알아내는 오라클이 된다.
 */
export function listCommentThreads(
  orgId: string,
  noteId: string,
): Promise<NoteCommentThreadView[]> {
  return prisma.noteCommentThread.findMany({
    where: { orgId, noteId },
    select: THREAD_SELECT,
    orderBy: { createdAt: 'asc' },
  });
}

export type CreateThreadOutcome =
  | { status: 'ok'; thread: NoteCommentThreadView }
  | { status: 'notfound' };

/**
 * 스레드를 열고 첫 코멘트를 단다 — **마크를 찍기 전에** 불린다(위 모듈 주석).
 *
 * 노트 존재는 여기서 확인한다. 목록 조회와 달리 이건 쓰기라, 없는 노트에 행을 만들면
 * FK가 막아 주더라도 그 실패가 P2003 500으로 새어 나간다(fail-closed로 판별 결과를 준다).
 */
export async function createCommentThread(
  orgId: string,
  noteId: string,
  authorId: string,
  body: string,
): Promise<CreateThreadOutcome> {
  await assertNotTombstoned([orgId, authorId]);

  const note = await prisma.note.findFirst({ where: { id: noteId, orgId }, select: { id: true } });
  if (!note) return { status: 'notfound' };

  const thread = await prisma.$transaction(async (tx) => {
    // 노트 이미지(KAN-38)와 같은 이유로 스켈레톤이 먼저다 — orgId·authorId가 FK이고,
    // 코멘트는 웹훅이 미러를 채우기 전에도 쓰일 수 있다.
    await orgSkeleton(orgId, tx);
    await userSkeleton(authorId, tx);
    return tx.noteCommentThread.create({
      data: {
        orgId,
        noteId,
        authorId,
        comments: { create: { orgId, authorId, body } },
      },
      select: THREAD_SELECT,
    });
  });

  // 되살아난 org·user를 자가 정리한다(createNote와 같은 pre/post 이중 가드).
  await assertNotTombstoned([orgId, authorId], async () => {
    await prisma.noteCommentThread.deleteMany({ where: { id: thread.id } });
  });

  return { status: 'ok', thread };
}

export type ReplyOutcome =
  | { status: 'ok'; thread: NoteCommentThreadView }
  | { status: 'notfound' };

/** 스레드에 답글을 단다. 조직 멤버면 누구나 — 노트가 org 전체 공개인 것과 같은 범위다. */
export async function addComment(
  orgId: string,
  threadId: string,
  authorId: string,
  body: string,
): Promise<ReplyOutcome> {
  await assertNotTombstoned([orgId, authorId]);

  // 스레드가 이 org의 것인지 먼저 본다 — 남의 워크스페이스 스레드에 답글이 달리지 않게.
  const thread = await prisma.noteCommentThread.findFirst({
    where: { id: threadId, orgId },
    select: { id: true },
  });
  if (!thread) return { status: 'notfound' };

  try {
    await prisma.$transaction(async (tx) => {
      await userSkeleton(authorId, tx);
      await tx.noteComment.create({ data: { orgId, threadId, authorId, body } });
    });
  } catch (error) {
    // 판정과 INSERT 사이에 스레드가 지워지면 FK가 막는다(P2003). 그건 '없는 스레드'와 같은
    // 상황이므로 같은 결과를 준다 — 그냥 새어 나가게 두면 사용자는 원인을 알 수 없는
    // 일반 오류를 받고, 재시도해도 영영 같은 결과다.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return { status: 'notfound' };
    }
    throw error;
  }

  const updated = await prisma.noteCommentThread.findFirst({
    where: { id: threadId, orgId },
    select: THREAD_SELECT,
  });
  return updated ? { status: 'ok', thread: updated } : { status: 'notfound' };
}

/**
 * 해결 표시를 켜고 끈다. **조직 멤버 누구나 할 수 있다** — 해결은 소유가 아니라 합의의
 * 신호이고, 되돌릴 수 있으므로 파괴적이지 않다. 반대로 작성자에게만 열어 두면 그 사람이
 * 자리를 비운 동안 문서에 강조가 영영 남는다.
 */
export async function setThreadResolved(
  orgId: string,
  threadId: string,
  userId: string,
  resolved: boolean,
): Promise<'ok' | 'notfound'> {
  // 단건 update가 아니라 updateMany — 남의 워크스페이스 id를 알아도 매칭 자체가 안 된다(규약 1).
  const { count } = await prisma.noteCommentThread.updateMany({
    where: { id: threadId, orgId },
    data: resolved
      ? { resolvedAt: new Date(), resolvedBy: userId }
      : { resolvedAt: null, resolvedBy: null },
  });
  return count === 1 ? 'ok' : 'notfound';
}

/**
 * 코멘트 한 건을 지운다 — 작성자 또는 admin(노트 수정 권한과 같은 정책, KAN-18).
 *
 * 마지막 코멘트가 사라지면 스레드도 함께 지운다. 빈 스레드는 본문에 강조만 남기고 열어도
 * 아무것도 없는 자리가 되므로, 그 상태를 만들 이유가 없다. 그러면 본문의 마크가 가리킬
 * 곳을 잃는데, 그건 저장 정규화가 걷어 간다(note-sanitize.ts) — 강조는 다음 저장에서
 * 사라지고 본문 자체는 그대로다.
 */
export async function deleteComment(
  orgId: string,
  commentId: string,
  actor: NoteActor,
): Promise<'ok' | 'forbidden' | 'notfound'> {
  return prisma.$transaction(async (tx) => {
    const comment = await tx.noteComment.findFirst({
      where: { id: commentId, orgId },
      select: { id: true, threadId: true, authorId: true },
    });
    if (!comment) return 'notfound';
    if (!actor.isAdmin && comment.authorId !== actor.userId) return 'forbidden';

    await tx.noteComment.deleteMany({ where: { id: commentId, orgId } });
    const remaining = await tx.noteComment.count({ where: { threadId: comment.threadId, orgId } });
    if (remaining === 0) {
      await tx.noteCommentThread.deleteMany({ where: { id: comment.threadId, orgId } });
    }
    return 'ok';
  });
}

/**
 * 이 노트에 실재하는 스레드 id — 저장 정규화가 '가리킬 곳 있는 앵커'를 가리는 근거다.
 *
 * noteId까지 무는 것이 핵심이다. orgId만 보면 **같은 조직의 다른 문서 스레드**를 가리키는
 * 앵커가 살아남고, 그 강조를 클릭하면 이 문서에 속하지 않은 대화가 열린다(복사·붙여넣기로
 * 자연히 생기는 경로다 — KAN-71의 이미지 복사와 같은 모양이지만 결론은 반대다: 첨부는
 * 여러 문서가 공유하는 오브젝트이고, 코멘트 스레드는 그 문서의 한 자리에 대한 대화다).
 */
export async function liveThreadIds(
  tx: Prisma.TransactionClient,
  orgId: string,
  noteId: string,
  referencedIds: string[],
): Promise<Set<string>> {
  if (referencedIds.length === 0) return new Set();
  const rows = await tx.noteCommentThread.findMany({
    where: { id: { in: [...new Set(referencedIds)] }, orgId, noteId },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}
