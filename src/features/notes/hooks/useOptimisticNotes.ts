'use client';

import { useCallback, useMemo, useOptimistic, useState } from 'react';
import type { Note } from '@/features/notes/types';

// pending은 생성 직후의 임시 카드 — 실제 id가 아직 없어 편집·삭제를 막아야 한다.
export type OptimisticNote = Note & { pending?: boolean };

export type NotesAction =
  | { type: 'create'; note: OptimisticNote }
  | { type: 'update'; id: string; patch: Pick<Note, 'title' | 'content' | 'updatedAt'> }
  | { type: 'delete'; id: string };

// 서버 정렬(updatedAt desc)을 그대로 따른다 — 생성·수정 모두 맨 앞으로.
// 순서가 다르면 revalidated RSC 도착 시 카드가 점프한다.
function reduceNotes(notes: OptimisticNote[], action: NotesAction): OptimisticNote[] {
  switch (action.type) {
    case 'create':
      return [action.note, ...notes];
    case 'update': {
      const target = notes.find((note) => note.id === action.id);
      if (!target) return notes;
      return [{ ...target, ...action.patch }, ...notes.filter((note) => note.id !== action.id)];
    }
    case 'delete':
      return notes.filter((note) => note.id !== action.id);
  }
}

// 서버 prop을 기준으로 낙관적 목록을 만드는 단일 재조정(reconcile) 경로.
// - 진행 중 액션: useOptimistic이 트랜지션 동안만 반영, 종료 시 서버 값으로 확정.
// - 확정된 삭제: 서버 revalidate 실패는 액션에서 삼켜지므로(ok 반환) stale prop이
//   다시 올 수 있다 — 서버가 삭제를 확정한 id는 따로 기억해 ghost card를 막는다.
export function useOptimisticNotes(serverNotes: Note[]) {
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(() => new Set());

  const baseNotes = useMemo(
    () =>
      deletedIds.size === 0
        ? serverNotes
        : serverNotes.filter((note) => !deletedIds.has(note.id)),
    [serverNotes, deletedIds],
  );

  const [notes, dispatch] = useOptimistic<OptimisticNote[], NotesAction>(baseNotes, reduceNotes);

  const confirmDeleted = useCallback((id: string) => {
    setDeletedIds((prev) => new Set(prev).add(id));
  }, []);

  return { notes, dispatch, confirmDeleted };
}
