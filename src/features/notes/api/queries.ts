import 'server-only';

import { requireOrgId } from '@/server/auth';
import * as notesService from '@/server/services/notes';
import type { Note } from '@/features/notes/types';

// 서버 컴포넌트에서 직접 호출하는 조회 헬퍼.
// 각 함수가 orgId 스코프를 스스로 붙여, 호출부가 조직을 착각해도 타 워크스페이스가
// 새지 않는다(자기 스코프 보장).

export async function fetchNotes(): Promise<Note[]> {
  const orgId = await requireOrgId();
  return notesService.listNotes(orgId);
}

export async function fetchNote(id: string): Promise<Note | null> {
  const orgId = await requireOrgId();
  return notesService.getNote(orgId, id);
}
