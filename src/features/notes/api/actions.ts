'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ko } from 'zod/locales';
import { requireOrgId } from '@/server/auth';
import * as notesService from '@/server/services/notes';
import type { ActionResult, Note } from '@/features/notes/types';

// 타입 불일치 등 커스텀 메시지가 없는 zod 에러가 영어로 노출되지 않도록
// 한국어 로케일을 전역 적용한다. 필드별 커스텀 메시지가 로케일보다 우선한다.
z.config(ko());

const noteInputSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력하세요.').max(200, '제목은 200자 이하여야 합니다.'),
  content: z.string().max(50_000, '본문이 너무 깁니다.').optional(),
});

const noteIdSchema = z.string().min(1, '노트 id가 필요합니다.');

// DB 장애 등 예상 못 한 예외가 액션 밖으로 던져지면 클라이언트는 digest만 담긴
// 불투명한 에러를 받는다 — ActionResult 계약을 지키기 위해 여기서 변환한다.
function toFailure(action: string, error: unknown): { ok: false; error: string } {
  console.error(`[notes] ${action} failed:`, error);
  return { ok: false, error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.' };
}

// Server Action은 클라이언트가 직접 POST할 수 있는 공개 엔드포인트다.
// 따라서 모든 액션은 진입부에서 requireOrgId + zod 검증을 거친다.
// requireOrgId는 try 밖에 둔다 — 인증 실패의 redirect는 잡으면 안 되는 제어 흐름이다.

export async function createNoteAction(input: unknown): Promise<ActionResult<Note>> {
  const orgId = await requireOrgId();

  const parsed = noteInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  try {
    const note = await notesService.createNote(orgId, parsed.data);
    revalidatePath('/notes');
    return { ok: true, data: note };
  } catch (error) {
    return toFailure('createNote', error);
  }
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

  try {
    const note = await notesService.updateNote(orgId, parsedId.data, parsedInput.data);
    if (!note) {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }

    revalidatePath('/notes');
    return { ok: true, data: note };
  } catch (error) {
    return toFailure('updateNote', error);
  }
}

export async function deleteNoteAction(id: unknown): Promise<ActionResult<{ id: string }>> {
  const orgId = await requireOrgId();

  const parsedId = noteIdSchema.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, error: parsedId.error.issues[0].message };
  }

  try {
    const deleted = await notesService.deleteNote(orgId, parsedId.data);
    if (!deleted) {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }

    revalidatePath('/notes');
    return { ok: true, data: { id: parsedId.data } };
  } catch (error) {
    return toFailure('deleteNote', error);
  }
}
