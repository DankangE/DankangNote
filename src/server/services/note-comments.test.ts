import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  ORG_A,
  ORG_B,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedTenants,
} from '../../../test/db';
import {
  addComment,
  createCommentThread,
  deleteComment,
  listCommentThreads,
  liveThreadIds,
  setThreadResolved,
} from './note-comments';
import { createNote, updateNote } from './notes';
import { COMMENT_MARK } from '@/features/notes/comments';

const owner = { userId: USER_OWNER, isAdmin: false };
const admin = { userId: USER_OWNER, isAdmin: true };
const other = { userId: USER_OTHER, isAdmin: false };

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
});

async function noteIn(orgId: string, authorId = USER_OWNER): Promise<string> {
  const note = await prisma.note.create({ data: { orgId, authorId, title: '문서' } });
  return note.id;
}

async function threadOn(noteId: string, orgId = ORG_A, authorId = USER_OWNER): Promise<string> {
  const outcome = await createCommentThread(orgId, noteId, authorId, '여기 확인해주세요');
  if (outcome.status !== 'ok') throw new Error(`스레드 생성 실패: ${outcome.status}`);
  return outcome.thread.id;
}

/** 코멘트 앵커가 달린 본문의 저장 문자열. */
const docWithAnchor = (threadId: string) =>
  JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '검토 대상', marks: [{ type: COMMENT_MARK, attrs: { threadId } }] },
        ],
      },
    ],
  });

describe('코멘트 스레드 (KAN-40)', () => {
  it('스레드를 열면 첫 코멘트가 함께 들어간다', async () => {
    const noteId = await noteIn(ORG_A);

    const outcome = await createCommentThread(ORG_A, noteId, USER_OWNER, '여기 확인해주세요');

    expect(outcome.status).toBe('ok');
    expect(outcome.status === 'ok' && outcome.thread.comments).toHaveLength(1);
    expect(outcome.status === 'ok' && outcome.thread.comments[0].body).toBe('여기 확인해주세요');
  });

  it('없는 노트에는 스레드를 못 연다 — FK 500이 아니라 판별 결과로', async () => {
    expect((await createCommentThread(ORG_A, 'nope', USER_OWNER, '내용')).status).toBe('notfound');
  });

  it('남의 워크스페이스 노트에도 못 연다 (없는 노트와 같은 결과 — 존재 오라클 없음)', async () => {
    const foreign = await noteIn(ORG_B);

    expect((await createCommentThread(ORG_A, foreign, USER_OWNER, '내용')).status).toBe('notfound');
    expect(await prisma.noteCommentThread.count()).toBe(0);
  });

  it('목록은 이 org·이 노트의 것만 — 같은 id를 알아도 남의 것은 안 나온다', async () => {
    const mine = await noteIn(ORG_A);
    const foreign = await noteIn(ORG_B);
    await threadOn(mine);
    await createCommentThread(ORG_B, foreign, USER_OWNER, '남의 코멘트');

    const threads = await listCommentThreads(ORG_A, mine);

    expect(threads).toHaveLength(1);
    // 남의 org에서 그 노트 id로 물어도 비어 있다.
    expect(await listCommentThreads(ORG_A, foreign)).toHaveLength(0);
  });

  it('답글은 시간순으로 붙는다', async () => {
    const noteId = await noteIn(ORG_A);
    const threadId = await threadOn(noteId);

    await addComment(ORG_A, threadId, USER_OTHER, '확인했습니다');
    const [thread] = await listCommentThreads(ORG_A, noteId);

    expect(thread.comments.map((c) => c.body)).toEqual(['여기 확인해주세요', '확인했습니다']);
  });

  it('남의 워크스페이스 스레드에는 답글이 안 달린다', async () => {
    const foreign = await noteIn(ORG_B);
    const foreignThread = await threadOn(foreign, ORG_B);

    expect((await addComment(ORG_A, foreignThread, USER_OWNER, '끼어들기')).status).toBe('notfound');
    expect(await prisma.noteComment.count({ where: { threadId: foreignThread } })).toBe(1);
  });

  it('해결은 조직 멤버 누구나 — 켜고 끌 수 있다', async () => {
    const noteId = await noteIn(ORG_A);
    const threadId = await threadOn(noteId);

    expect(await setThreadResolved(ORG_A, threadId, USER_OTHER, true)).toBe('ok');
    expect((await listCommentThreads(ORG_A, noteId))[0].resolvedAt).not.toBeNull();

    expect(await setThreadResolved(ORG_A, threadId, USER_OTHER, false)).toBe('ok');
    expect((await listCommentThreads(ORG_A, noteId))[0].resolvedAt).toBeNull();
  });

  it('남의 워크스페이스 스레드는 해결할 수 없다', async () => {
    const foreign = await noteIn(ORG_B);
    const foreignThread = await threadOn(foreign, ORG_B);

    expect(await setThreadResolved(ORG_A, foreignThread, USER_OWNER, true)).toBe('notfound');
    const row = await prisma.noteCommentThread.findUniqueOrThrow({ where: { id: foreignThread } });
    expect(row.resolvedAt).toBeNull();
  });
});

describe('코멘트 삭제 (KAN-40)', () => {
  it('남의 코멘트는 지울 수 없다', async () => {
    const noteId = await noteIn(ORG_A);
    await threadOn(noteId);
    const [comment] = (await listCommentThreads(ORG_A, noteId))[0].comments;

    expect(await deleteComment(ORG_A, comment.id, other)).toBe('forbidden');
    expect(await prisma.noteComment.count({ where: { id: comment.id } })).toBe(1);
  });

  it('admin은 남의 코멘트도 지운다 (노트 수정 권한과 같은 정책)', async () => {
    const noteId = await noteIn(ORG_A);
    const outcome = await createCommentThread(ORG_A, noteId, USER_OTHER, '남의 코멘트');
    if (outcome.status !== 'ok') throw new Error('스레드 생성 실패');

    expect(await deleteComment(ORG_A, outcome.thread.comments[0].id, admin)).toBe('ok');
  });

  it('마지막 코멘트가 사라지면 스레드도 함께 사라진다 — 빈 스레드를 남기지 않는다', async () => {
    const noteId = await noteIn(ORG_A);
    const threadId = await threadOn(noteId);
    const [comment] = (await listCommentThreads(ORG_A, noteId))[0].comments;

    expect(await deleteComment(ORG_A, comment.id, owner)).toBe('ok');
    expect(await prisma.noteCommentThread.count({ where: { id: threadId } })).toBe(0);
  });

  it('답글이 남아 있으면 스레드는 유지된다', async () => {
    const noteId = await noteIn(ORG_A);
    const threadId = await threadOn(noteId);
    await addComment(ORG_A, threadId, USER_OTHER, '답글');
    const [first] = (await listCommentThreads(ORG_A, noteId))[0].comments;

    expect(await deleteComment(ORG_A, first.id, owner)).toBe('ok');
    expect(await prisma.noteCommentThread.count({ where: { id: threadId } })).toBe(1);
  });

  it('남의 워크스페이스 코멘트는 id를 알아도 안 보인다', async () => {
    const foreign = await noteIn(ORG_B);
    const foreignThread = await threadOn(foreign, ORG_B);
    const [comment] = (await listCommentThreads(ORG_B, foreign))[0].comments;

    expect(await deleteComment(ORG_A, comment.id, admin)).toBe('notfound');
    expect(await prisma.noteComment.count({ where: { threadId: foreignThread } })).toBe(1);
  });
});

describe('앵커 정규화 (KAN-40)', () => {
  it('살아 있는 스레드를 가리키는 앵커는 저장에 남는다', async () => {
    const noteId = await noteIn(ORG_A);
    const threadId = await threadOn(noteId);

    const saved = await updateNote(ORG_A, noteId, { content: docWithAnchor(threadId) }, owner);

    expect(saved.status).toBe('ok');
    const note = await prisma.note.findUniqueOrThrow({ where: { id: noteId } });
    expect(note.content).toContain(threadId);
  });

  it('지워진 스레드를 가리키는 앵커는 마크만 떨어지고 **본문은 남는다**', async () => {
    const noteId = await noteIn(ORG_A);
    const threadId = await threadOn(noteId);
    const [comment] = (await listCommentThreads(ORG_A, noteId))[0].comments;
    await deleteComment(ORG_A, comment.id, owner); // 마지막 코멘트 → 스레드도 사라진다

    const saved = await updateNote(ORG_A, noteId, { content: docWithAnchor(threadId) }, owner);

    expect(saved.status).toBe('ok');
    const note = await prisma.note.findUniqueOrThrow({ where: { id: noteId } });
    expect(note.content).not.toContain(threadId);
    // 이미지와 정반대다 — 문장까지 지우면 사용자가 쓴 본문이 사라진다.
    expect(note.content).toContain('검토 대상');
  });

  it('같은 조직의 **다른 문서** 스레드를 가리키는 앵커도 떨어진다', async () => {
    const source = await noteIn(ORG_A);
    const target = await noteIn(ORG_A);
    const threadId = await threadOn(source);

    await updateNote(ORG_A, target, { content: docWithAnchor(threadId) }, owner);

    const note = await prisma.note.findUniqueOrThrow({ where: { id: target } });
    expect(note.content).not.toContain(threadId);
    // 원본 문서의 스레드는 그대로다 — 복사한 쪽만 앵커를 잃는다.
    expect(await prisma.noteCommentThread.count({ where: { id: threadId } })).toBe(1);
  });

  it('새 문서에 실려 온 앵커는 전부 떨어진다 — 스레드는 노트가 생긴 뒤에만 열린다', async () => {
    const source = await noteIn(ORG_A);
    const threadId = await threadOn(source);

    const created = await createNote(
      ORG_A,
      USER_OWNER,
      { title: '복사본', content: docWithAnchor(threadId) },
    );

    expect(created.status).toBe('ok');
    expect(created.status === 'ok' && created.note.content).not.toContain(threadId);
  });

  it('liveThreadIds는 noteId까지 문다 — orgId만 보면 남의 문서 앵커가 살아남는다', async () => {
    const source = await noteIn(ORG_A);
    const target = await noteIn(ORG_A);
    const threadId = await threadOn(source);

    const live = await prisma.$transaction((tx) =>
      liveThreadIds(tx, ORG_A, target, [threadId]),
    );

    expect(live.size).toBe(0);
  });
});

describe('테넌트 수명 (KAN-40)', () => {
  it('노트를 지우면 그 코멘트도 함께 사라진다', async () => {
    const noteId = await noteIn(ORG_A);
    await threadOn(noteId);

    await prisma.note.delete({ where: { id: noteId } });

    expect(await prisma.noteCommentThread.count()).toBe(0);
    expect(await prisma.noteComment.count()).toBe(0);
  });

  it('조직을 지우면 그 조직 코멘트가 전부 사라진다 (규약 6)', async () => {
    const noteId = await noteIn(ORG_A);
    await threadOn(noteId);
    const foreign = await noteIn(ORG_B);
    await threadOn(foreign, ORG_B);

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.noteCommentThread.count()).toBe(1);
    expect(await prisma.noteComment.count()).toBe(1);
  });
});
