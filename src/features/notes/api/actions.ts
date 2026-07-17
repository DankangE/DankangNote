'use server';

import { revalidatePath } from 'next/cache';
import { z } from '@/lib/zod';
import { requireOrgId } from '@/server/auth';
import * as notesService from '@/server/services/notes';
import type { ActionResult, Note } from '@/features/notes/types';

const noteInputSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력하세요.').max(200, '제목은 200자 이하여야 합니다.'),
  content: z.string().max(50_000, '본문이 너무 깁니다.').optional(),
});

const noteIdSchema = z.string().min(1, '노트 id가 필요합니다.');

// DB 장애나 인증/조직 확인 실패 등 예상 못 한 예외가 액션 밖으로 던져지면
// 클라이언트는 digest만 담긴 불투명한 에러를 받는다 — ActionResult 계약은 이 래퍼
// 한 곳에서 강제한다. requireOrgId도 이 안에서 호출해 orgId 부재 예외까지 포섭한다.
async function guarded<T>(
  action: string,
  fn: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[notes] ${action} failed:`, error);
    return { ok: false, error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

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
// 진입부에서 zod로 입력을 검증하고(검증 실패는 필드별 메시지), 인증·조직 확인과
// 서비스 호출은 guarded 안에서 수행한다 — orgId 부재(조직 미선택 등) 예외도
// ActionResult 실패로 안전하게 변환된다.

export async function createNoteAction(input: unknown): Promise<ActionResult<Note>> {
  const parsed = noteInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  return guarded('createNote', async () => {
    const orgId = await requireOrgId();
    const note = await notesService.createNote(orgId, parsed.data);
    revalidateNotes('createNote');
    return { ok: true, data: note };
  });
}

export async function updateNoteAction(
  id: unknown,
  input: unknown,
): Promise<ActionResult<Note>> {
  const parsedId = noteIdSchema.safeParse(id);
  const parsedInput = noteInputSchema.partial().safeParse(input);
  if (!parsedId.success) {
    return { ok: false, error: parsedId.error.issues[0].message };
  }
  if (!parsedInput.success) {
    return { ok: false, error: parsedInput.error.issues[0].message };
  }

  return guarded('updateNote', async () => {
    const orgId = await requireOrgId();
    const note = await notesService.updateNote(orgId, parsedId.data, parsedInput.data);
    if (!note) {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }

    revalidateNotes('updateNote');
    return { ok: true, data: note };
  });
}

export async function deleteNoteAction(id: unknown): Promise<ActionResult<{ id: string }>> {
  const parsedId = noteIdSchema.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, error: parsedId.error.issues[0].message };
  }

  return guarded('deleteNote', async () => {
    const orgId = await requireOrgId();
    const deleted = await notesService.deleteNote(orgId, parsedId.data);
    if (!deleted) {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }

    revalidateNotes('deleteNote');
    return { ok: true, data: { id: parsedId.data } };
  });
}
