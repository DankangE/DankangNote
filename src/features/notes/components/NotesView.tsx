import type { Note, NoteViewer } from '@/features/notes/types';
import { CenteredPage } from '@/lib/components/CenteredPage';
import { NotesBoard } from './NotesBoard';

// 노트 화면 조합. 서버 컴포넌트 — 정적 헤더만 두고, 상호작용과 낙관적 목록은
// NotesBoard(클라이언트 경계)에 위임한다.
export function NotesView({ notes, viewer }: { notes: Note[]; viewer: NoteViewer | null }) {
  return (
    <CenteredPage>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">노트</h1>
        <p className="text-muted-foreground">워크스페이스의 모든 노트</p>
      </div>

      <NotesBoard notes={notes} viewer={viewer} />
    </CenteredPage>
  );
}
