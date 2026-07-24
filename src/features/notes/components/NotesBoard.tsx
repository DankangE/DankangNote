'use client';

import { EmptyState } from '@/lib/components/EmptyState';
import { useOptimisticNotes } from '@/features/notes/hooks/useOptimisticNotes';
import type { Note, NoteViewer } from '@/features/notes/types';
import { NoteCard } from './NoteCard';
import { NoteComposer } from './NoteComposer';

// 낙관적 업데이트 경계. 생성·수정·삭제를 서버 응답 전에 목록에 먼저 반영하고,
// revalidated RSC가 도착하면 서버 값으로 확정한다 (KAN-9).
export function NotesBoard({ notes, viewer }: { notes: Note[]; viewer: NoteViewer | null }) {
  const { notes: optimisticNotes, dispatch, confirmDeleted } = useOptimisticNotes(notes);

  return (
    <>
      <NoteComposer dispatch={dispatch} />

      {optimisticNotes.length === 0 ? (
        <EmptyState title="아직 노트가 없어요" description="위에서 첫 노트를 추가해 보세요." />
      ) : (
        <div className="flex flex-col gap-3">
          {optimisticNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              viewer={viewer}
              dispatch={dispatch}
              onDeleted={confirmDeleted}
            />
          ))}
        </div>
      )}
    </>
  );
}
