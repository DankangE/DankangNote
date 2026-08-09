'use server';

import { revalidatePath } from 'next/cache';
import { guarded, parseOrError } from '@/lib/action-result';
import { resolveOrg } from '@/server/auth';
import * as comments from '@/server/services/note-comments';
import type { ActionResult } from '@/lib/action-result';
import type { NoteCommentThreadView } from '@/server/services/note-comments';
import {
  commentBodySchema,
  commentIdSchema,
  commentThreadIdSchema,
  noteIdSchema,
} from './validation';

// 인라인 코멘트 액션 (KAN-40). notes/actions.ts와 나눈 이유는 하나다 — 'use server' 모듈은
// export한 함수 **전부**가 엔드포인트가 되므로, 한 파일이 커질수록 그 표면을 한눈에 보기
// 어려워진다. 코멘트는 노트 본문과 수명도 권한도 달라 따로 둔다.

// 코멘트는 본문 옆에 붙어 상세 화면에서만 보인다 — 트리 사이드바는 바뀌지 않으므로
// notes/actions.ts와 달리 layout이 아니라 그 경로만 되살린다.
function revalidateNote(noteId: string): void {
  try {
    revalidatePath(`/notes/${noteId}`);
  } catch (error) {
    // 쓰기 커밋 이후의 revalidate 실패는 뮤테이션 실패가 아니다(notes/actions.ts와 같은 규칙).
    console.error('[action] revalidate failed:', error);
  }
}

/**
 * 스레드를 열고 첫 코멘트를 단다. **본문에 마크를 찍기 전에** 불러야 한다 — 반환된 id로
 * 마크를 찍고 저장하는 순서다. 반대로 하면 저장 정규화가 가리킬 곳 없는 마크로 보고
 * 떨군다(note-sanitize.ts).
 */
export async function createCommentThreadAction(
  noteId: unknown,
  body: unknown,
): Promise<ActionResult<NoteCommentThreadView>> {
  const org = await resolveOrg();
  if ('error' in org) return { ok: false, error: org.error };

  const parsedNote = parseOrError(noteIdSchema, noteId);
  if (!parsedNote.ok) return parsedNote;
  const parsedBody = parseOrError(commentBodySchema, body);
  if (!parsedBody.ok) return parsedBody;

  return guarded('noteComments.createThread', async () => {
    const outcome = await comments.createCommentThread(
      org.orgId,
      parsedNote.data,
      org.userId,
      parsedBody.data,
    );
    if (outcome.status === 'notfound') {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }
    revalidateNote(parsedNote.data);
    return { ok: true, data: outcome.thread };
  });
}

export async function addCommentAction(
  threadId: unknown,
  body: unknown,
): Promise<ActionResult<NoteCommentThreadView>> {
  const org = await resolveOrg();
  if ('error' in org) return { ok: false, error: org.error };

  const parsedThread = parseOrError(commentThreadIdSchema, threadId);
  if (!parsedThread.ok) return parsedThread;
  const parsedBody = parseOrError(commentBodySchema, body);
  if (!parsedBody.ok) return parsedBody;

  return guarded('noteComments.addComment', async () => {
    const outcome = await comments.addComment(
      org.orgId,
      parsedThread.data,
      org.userId,
      parsedBody.data,
    );
    if (outcome.status === 'notfound') {
      return { ok: false, error: '코멘트 스레드를 찾을 수 없습니다.' };
    }
    revalidateNote(outcome.thread.noteId);
    return { ok: true, data: outcome.thread };
  });
}

export async function setThreadResolvedAction(
  threadId: unknown,
  resolved: unknown,
): Promise<ActionResult<{ id: string; resolved: boolean }>> {
  const org = await resolveOrg();
  if ('error' in org) return { ok: false, error: org.error };

  const parsedThread = parseOrError(commentThreadIdSchema, threadId);
  if (!parsedThread.ok) return parsedThread;
  if (typeof resolved !== 'boolean') {
    return { ok: false, error: '요청 형식이 올바르지 않습니다.' };
  }

  return guarded('noteComments.setResolved', async () => {
    const outcome = await comments.setThreadResolved(
      org.orgId,
      parsedThread.data,
      org.userId,
      resolved,
    );
    if (outcome === 'notfound') {
      return { ok: false, error: '코멘트 스레드를 찾을 수 없습니다.' };
    }
    return { ok: true, data: { id: parsedThread.data, resolved } };
  });
}

export async function deleteCommentAction(
  commentId: unknown,
): Promise<ActionResult<{ id: string }>> {
  const org = await resolveOrg();
  if ('error' in org) return { ok: false, error: org.error };

  const parsed = parseOrError(commentIdSchema, commentId);
  if (!parsed.ok) return parsed;

  return guarded('noteComments.deleteComment', async () => {
    const outcome = await comments.deleteComment(org.orgId, parsed.data, {
      userId: org.userId,
      isAdmin: org.isAdmin,
    });
    if (outcome === 'forbidden') {
      return { ok: false, error: '이 코멘트를 지울 권한이 없습니다. 작성자 또는 관리자만 지울 수 있습니다.' };
    }
    if (outcome === 'notfound') {
      return { ok: false, error: '코멘트를 찾을 수 없습니다.' };
    }
    return { ok: true, data: { id: parsed.data } };
  });
}
