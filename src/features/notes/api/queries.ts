import 'server-only';

import { requireOrg, requireOrgId } from '@/server/auth';
import * as notesService from '@/server/services/notes';
import { listNoteTree } from '@/server/services/note-tree';
import { listFavoriteNoteIds } from '@/server/services/note-favorites';
import type { Note, NoteTreeNode } from '@/features/notes/types';
import { noteIdSchema } from './validation';

// 서버 컴포넌트에서 직접 호출하는 조회 헬퍼.
// 각 함수가 orgId 스코프를 스스로 붙여, 호출부가 조직을 착각해도 타 워크스페이스가
// 새지 않는다(자기 스코프 보장).

export async function fetchNotes(): Promise<Note[]> {
  const orgId = await requireOrgId();
  return notesService.listNotes(orgId);
}

// 사이드바 트리(KAN-37) — 전 노트의 최소 노드 flat 목록. 트리 조립은 클라이언트가 한다.
export async function fetchNoteTree(): Promise<NoteTreeNode[]> {
  const orgId = await requireOrgId();
  return listNoteTree(orgId);
}

// 내 즐겨찾기 노트 id 목록(KAN-37) — 노드 정보는 트리가 이미 들고 있다.
export async function fetchFavoriteNoteIds(): Promise<string[]> {
  const { orgId, userId } = await requireOrg();
  return listFavoriteNoteIds(orgId, userId);
}

export async function fetchNote(id: string): Promise<Note | null> {
  const orgId = await requireOrgId();
  // 조회 계열은 액션과 달리 에러 채널이 없다 — 형식이 틀린 id는 '없는 노트'(null)로 취급.
  const parsed = noteIdSchema.safeParse(id);
  if (!parsed.success) {
    return null;
  }
  return notesService.getNote(orgId, parsed.data);
}
