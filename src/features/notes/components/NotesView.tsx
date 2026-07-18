import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import type { Note } from '@/features/notes/types';
import { CenteredPage } from './CenteredPage';
import { NoteCard } from './NoteCard';
import { NoteComposer } from './NoteComposer';

// 노트 화면 조합. 서버 컴포넌트 — 상호작용은 자식(NoteComposer/NoteCard)에만 있다.
export function NotesView({ notes }: { notes: Note[] }) {
  return (
    <CenteredPage>
      <Stack direction="vertical" gap={1}>
        <Heading level={1}>노트</Heading>
        <Text color="secondary">워크스페이스의 모든 노트</Text>
      </Stack>

      <NoteComposer />

      {notes.length === 0 ? (
        <EmptyState title="아직 노트가 없어요" description="위에서 첫 노트를 추가해 보세요." />
      ) : (
        <Stack direction="vertical" gap={3}>
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
        </Stack>
      )}
    </CenteredPage>
  );
}
