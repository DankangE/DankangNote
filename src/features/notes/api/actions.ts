'use server';

import { revalidatePath } from 'next/cache';
import { guarded, parseOrError } from '@/lib/action-result';
import { resolveOrg } from '@/server/auth';
import * as notesService from '@/server/services/notes';
import type { ActionResult, Note } from '@/features/notes/types';
import { noteIdSchema, noteInputSchema } from './validation';

// 쓰기 커밋 이후의 revalidate 실패는 뮤테이션 실패가 아니다 — 실패로 오보고하면
// 재시도가 중복 생성/유령 삭제를 만든다. 로그만 남기고 성공으로 처리한다.
function revalidateNotes(action: string): void {
  try {
    revalidatePath('/notes');
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

  const parsed = parseOrError(noteInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('notes.createNote', async () => {
    const note = await notesService.createNote(org.orgId, org.userId, parsed.data);
    revalidateNotes('createNote');
    return { ok: true, data: note };
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

  return guarded('notes.updateNote', async () => {
    const note = await notesService.updateNote(org.orgId, parsedId.data, parsedInput.data);
    if (!note) {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }

    revalidateNotes('updateNote');
    return { ok: true, data: note };
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
    const deleted = await notesService.deleteNote(org.orgId, parsedId.data);
    if (!deleted) {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }

    revalidateNotes('deleteNote');
    return { ok: true, data: { id: parsedId.data } };
  });
}
