import 'server-only';

import { requireOrgId } from '@/server/auth';
import * as notesService from '@/server/services/notes';
import type { Note } from '@/features/notes/types';

// 서버 컴포넌트에서 직접 호출하는 조회 헬퍼.

// 페이지가 auth.protect()로 이미 orgId를 확보한 경우 그대로 넘겨 auth 재해석을 피한다.
export async function fetchNotes(orgId: string): Promise<Note[]> {
  return notesService.listNotes(orgId);
}

export async function fetchNote(id: string): Promise<Note | null> {
  const orgId = await requireOrgId();
  return notesService.getNote(orgId, id);
}
