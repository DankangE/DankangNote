import 'server-only';

import { requireOrgId } from '@/server/auth';
import * as notesService from '@/server/services/notes';
import type { Note } from '@/features/notes/types';

// 서버 컴포넌트에서 직접 호출하는 조회 헬퍼.
// 페이지가 orgId를 몰라도 되도록 여기서 스코프를 붙인다.

export async function fetchNotes(): Promise<Note[]> {
  const orgId = await requireOrgId();
  return notesService.listNotes(orgId);
}

export async function fetchNote(id: string): Promise<Note | null> {
  const orgId = await requireOrgId();
  return notesService.getNote(orgId, id);
}
