'use server';

import { revalidatePath } from 'next/cache';
import { z } from '@/lib/zod';
import { getOrgId } from '@/server/auth';
import * as notesService from '@/server/services/notes';
import type { ActionResult, Note } from '@/features/notes/types';

const noteInputSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력하세요.').max(200, '제목은 200자 이하여야 합니다.'),
  content: z.string().max(50_000, '본문이 너무 깁니다.').optional(),
});

const noteIdSchema = z.string().min(1, '노트 id가 필요합니다.');

const NO_ORG_ERROR = '워크스페이스(조직)를 선택하거나 만들어야 합니다.';

// DB 장애 등 예상 못 한 예외가 액션 밖으로 던져지면 클라이언트는 digest만 담긴
// 불투명한 에러를 받는다 — ActionResult 계약은 이 래퍼 한 곳에서 강제한다.
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
// 진입부에서 인증·조직 확인을 zod 검증보다 먼저 수행한다(backend.md: 진입부 auth).
// 조직 부재는 예외가 아닌 정상 상태이므로 특정 메시지로 {ok:false}를 반환하고,
// DB 예외 등 예상 못 한 실패만 guarded가 generic 메시지로 변환한다.

export async function createNoteAction(input: unknown): Promise<ActionResult<Note>> {
  const orgId = await getOrgId();
  if (!orgId) {
    return { ok: false, error: NO_ORG_ERROR };
  }

  const parsed = noteInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  return guarded('createNote', async () => {
    const note = await notesService.createNote(orgId, parsed.data);
    revalidateNotes('createNote');
    return { ok: true, data: note };
  });
}

export async function updateNoteAction(
  id: unknown,
  input: unknown,
): Promise<ActionResult<Note>> {
  const orgId = await getOrgId();
  if (!orgId) {
    return { ok: false, error: NO_ORG_ERROR };
  }

  const parsedId = noteIdSchema.safeParse(id);
  const parsedInput = noteInputSchema.partial().safeParse(input);
  if (!parsedId.success) {
    return { ok: false, error: parsedId.error.issues[0].message };
  }
  if (!parsedInput.success) {
    return { ok: false, error: parsedInput.error.issues[0].message };
  }

  return guarded('updateNote', async () => {
    const note = await notesService.updateNote(orgId, parsedId.data, parsedInput.data);
    if (!note) {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }

    revalidateNotes('updateNote');
    return { ok: true, data: note };
  });
}

export async function deleteNoteAction(id: unknown): Promise<ActionResult<{ id: string }>> {
  const orgId = await getOrgId();
  if (!orgId) {
    return { ok: false, error: NO_ORG_ERROR };
  }

  const parsedId = noteIdSchema.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, error: parsedId.error.issues[0].message };
  }

  return guarded('deleteNote', async () => {
    const deleted = await notesService.deleteNote(orgId, parsedId.data);
    if (!deleted) {
      return { ok: false, error: '노트를 찾을 수 없습니다.' };
    }

    revalidateNotes('deleteNote');
    return { ok: true, data: { id: parsedId.data } };
  });
}
