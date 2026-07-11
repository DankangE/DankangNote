'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireOrgId } from '@/server/auth';
import * as notesService from '@/server/services/notes';
import type { ActionResult, Note } from '@/features/notes/types';

const noteInputSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력하세요.').max(200, '제목은 200자 이하여야 합니다.'),
  content: z.string().max(50_000, '본문이 너무 깁니다.').optional(),
});

const noteIdSchema = z.string().min(1, '노트 id가 필요합니다.');

// Server Action은 클라이언트가 직접 POST할 수 있는 공개 엔드포인트다.
// 따라서 모든 액션은 진입부에서 requireOrgId + zod 검증을 거친다.

export async function createNoteAction(input: unknown): Promise<ActionResult<Note>> {
  const orgId = await requireOrgId();

  const parsed = noteInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const note = await notesService.createNote(orgId, parsed.data);
  revalidatePath('/notes');
  return { ok: true, data: note };
}

export async function updateNoteAction(
  id: unknown,
  input: unknown,
): Promise<ActionResult<Note>> {
  const orgId = await requireOrgId();

  const parsedId = noteIdSchema.safeParse(id);
  const parsedInput = noteInputSchema.partial().safeParse(input);
  if (!parsedId.success) {
    return { ok: false, error: parsedId.error.issues[0].message };
  }
  if (!parsedInput.success) {
    return { ok: false, error: parsedInput.error.issues[0].message };
  }

  const note = await notesService.updateNote(orgId, parsedId.data, parsedInput.data);
  if (!note) {
    return { ok: false, error: '노트를 찾을 수 없습니다.' };
  }

  revalidatePath('/notes');
  return { ok: true, data: note };
}

export async function deleteNoteAction(id: unknown): Promise<ActionResult<{ id: string }>> {
  const orgId = await requireOrgId();

  const parsedId = noteIdSchema.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, error: parsedId.error.issues[0].message };
  }

  const deleted = await notesService.deleteNote(orgId, parsedId.data);
  if (!deleted) {
    return { ok: false, error: '노트를 찾을 수 없습니다.' };
  }

  revalidatePath('/notes');
  return { ok: true, data: { id: parsedId.data } };
}
