import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import type { Note } from '@/features/notes/types';
import { CenteredPage } from '@/lib/components/CenteredPage';
import { NotesBoard } from './NotesBoard';

// 노트 화면 조합. 서버 컴포넌트 — 정적 헤더만 두고, 상호작용과 낙관적 목록은
// NotesBoard(클라이언트 경계)에 위임한다.
export function NotesView({ notes }: { notes: Note[] }) {
  return (
    <CenteredPage>
      <Stack direction="vertical" gap={1}>
        <Heading level={1}>노트</Heading>
        <Text color="secondary">워크스페이스의 모든 노트</Text>
      </Stack>

      <NotesBoard notes={notes} />
    </CenteredPage>
  );
}
