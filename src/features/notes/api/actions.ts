'use server';

import { revalidatePath } from 'next/cache';
import { guarded, parseOrError } from '@/lib/action-result';
import { resolveOrg } from '@/server/auth';
import * as notesService from '@/server/services/notes';
import { moveNote } from '@/server/services/note-tree';
import { toggleFavorite } from '@/server/services/note-favorites';
import { serializeNoteContent } from '@/features/notes/content';
import { collectNoteAttachmentIds } from '@/features/notes/attachments';
import type { ActionResult, Note } from '@/features/notes/types';
import { createNoteInputSchema, moveNoteTargetSchema, noteIdSchema, noteInputSchema } from './validation';

// 쓰기 커밋 이후의 revalidate 실패는 뮤테이션 실패가 아니다 — 실패로 오보고하면
// 재시도가 중복 생성/유령 삭제를 만든다. 로그만 남기고 성공으로 처리한다.
// 'layout' 스코프인 이유: 트리 사이드바(KAN-37)가 notes/layout.tsx에서 조회되므로
// 페이지만 revalidate하면 상세는 갱신되고 사이드바가 낡는다(채팅 KAN-28과 같은 결정).
function revalidateNotes(action: string): void {
  try {
    revalidatePath('/notes', 'layout');
  } catch (error) {
    console.error(`[notes] ${action} revalidate failed:`, error);
  }
}

// Server Action은 클라이언트가 직접 POST할 수 있는 공개 엔드포인트다.
// 진입부에서 인증·조직 확인을 zod 검증보다 먼저 수행한다(backend.md: 진입부 auth).

export async function createNoteAction(input: unknown): Promise<ActionResult<Note>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(createNoteInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  // content(Tiptap doc)는 저장 문자열로 직렬화한다. 빈 doc은 ''(컬럼 기본값)이 된다.
  const { title, content, parentId } = parsed.data;
  const serialized = content ? serializeNoteContent(content) : '';

  return guarded('notes.createNote', async () => {
    const outcome = await notesService.createNote(
      org.orgId,
      org.userId,
      { title, content: serialized, parentId: parentId ?? null },
      // 본문 이미지 바인딩(KAN-38) — 검증된 doc에서 참조 id를 뽑아 생성과 한 트랜잭션으로.
      content ? collectNoteAttachmentIds(content) : [],
    );
    if (outcome.status === 'invalidparent') {
      return { ok: false, error: '상위 문서를 찾을 수 없습니다.' };
    }
    if (outcome.status === 'invalidattachment') {
      return { ok: false, error: '본문의 이미지를 확인할 수 없습니다. 이미지를 다시 넣어 주세요.' };
    }
    revalidateNotes('createNote');
    return { ok: true, data: outcome.note };
  });
}

// 트리 이동(KAN-37) — 재부모화 + 형제 그룹 내 위치. 사이클·교차 org·소유권은 서비스가
// 트랜잭션 안에서 판정한다(moveNote 주석 참조).
export async function moveNoteAction(
  id: unknown,
  target: unknown,
): Promise<ActionResult<{ id: string }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsedId = parseOrError(noteIdSchema, id);
  if (!parsedId.ok) {
    return parsedId;
  }
  const parsedTarget = parseOrError(moveNoteTargetSchema, target);
  if (!parsedTarget.ok) {
    return parsedTarget;
  }

  return guarded('notes.moveNote', async () => {
    const outcome = await moveNote(org.orgId, parsedId.data, parsedTarget.data, {
      userId: org.userId,
      isAdmin: org.isAdmin,
    });
    if (outcome === 'forbidden') {
      return { ok: false, error: '이 문서를 이동할 권한이 없습니다. 작성자 또는 관리자만 이동할 수 있습니다.' };
    }
    if (outcome === 'notfound') {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }
    if (outcome === 'invalidparent') {
      return { ok: false, error: '이동할 위치를 찾을 수 없습니다.' };
    }
    if (outcome === 'cycle') {
      return { ok: false, error: '문서를 자기 자신의 하위로 옮길 수 없습니다.' };
    }
    revalidateNotes('moveNote');
    return { ok: true, data: { id: parsedId.data } };
  });
}

// 즐겨찾기 토글(KAN-37) — 사용자별 상태라 소유권 판정이 없다(서비스 주석 참조).
export async function toggleFavoriteAction(
  id: unknown,
): Promise<ActionResult<{ favorited: boolean }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsedId = parseOrError(noteIdSchema, id);
  if (!parsedId.ok) {
    return parsedId;
  }

  return guarded('notes.toggleFavorite', async () => {
    const outcome = await toggleFavorite(org.orgId, org.userId, parsedId.data);
    if (outcome.status === 'notfound') {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }
    revalidateNotes('toggleFavorite');
    return { ok: true, data: { favorited: outcome.favorited } };
  });
}

export async function updateNoteAction(
  id: unknown,
  input: unknown,
): Promise<ActionResult<Note>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsedId = parseOrError(noteIdSchema, id);
  if (!parsedId.ok) {
    return parsedId;
  }
  const parsedInput = parseOrError(noteInputSchema.partial(), input);
  if (!parsedInput.ok) {
    return parsedInput;
  }

  // 부분 업데이트: 제공된 필드만 전달한다. content(doc)는 저장 문자열로 직렬화.
  const patch: { title?: string; content?: string } = {};
  if (parsedInput.data.title !== undefined) patch.title = parsedInput.data.title;
  if (parsedInput.data.content !== undefined) {
    patch.content = serializeNoteContent(parsedInput.data.content);
  }

  return guarded('notes.updateNote', async () => {
    const outcome = await notesService.updateNote(
      org.orgId,
      parsedId.data,
      patch,
      { userId: org.userId, isAdmin: org.isAdmin },
      parsedInput.data.content !== undefined
        ? collectNoteAttachmentIds(parsedInput.data.content)
        : [],
    );
    if (outcome.status === 'invalidattachment') {
      return { ok: false, error: '본문의 이미지를 확인할 수 없습니다. 이미지를 다시 넣어 주세요.' };
    }
    if (outcome.status === 'forbidden') {
      return { ok: false, error: '이 노트를 수정할 권한이 없습니다. 작성자 또는 관리자만 수정할 수 있습니다.' };
    }
    if (outcome.status === 'notfound') {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }

    revalidateNotes('updateNote');
    return { ok: true, data: outcome.note };
  });
}

export async function deleteNoteAction(id: unknown): Promise<ActionResult<{ id: string }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsedId = parseOrError(noteIdSchema, id);
  if (!parsedId.ok) {
    return parsedId;
  }

  return guarded('notes.deleteNote', async () => {
    const outcome = await notesService.deleteNote(org.orgId, parsedId.data, {
      userId: org.userId,
      isAdmin: org.isAdmin,
    });
    if (outcome === 'forbidden') {
      return { ok: false, error: '이 노트를 삭제할 권한이 없습니다. 작성자 또는 관리자만 삭제할 수 있습니다.' };
    }
    if (outcome === 'notfound') {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }

    revalidateNotes('deleteNote');
    return { ok: true, data: { id: parsedId.data } };
  });
}
