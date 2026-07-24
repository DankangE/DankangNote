import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import type { BoardView as BoardData } from '@/features/board/types';
import { BoardClient } from './BoardClient';

// 서버 컴포넌트 — 정적 헤더만 두고 상호작용·상태는 BoardClient(클라이언트 경계)에 위임한다.
// 보드는 컬럼 가로 스크롤이 필요해 노트처럼 좁게 가운데 정렬(CenteredPage)하지 않는다.
export function BoardView({ board }: { board: BoardData }) {
  return (
    <Stack direction="vertical" gap={4} paddingInline={6} paddingBlock={4}>
      <Stack direction="vertical" gap={1}>
        <Heading level={1}>보드</Heading>
        <Text color="secondary">워크스페이스의 칸반 보드</Text>
      </Stack>
      <BoardClient initialBoard={board} />
    </Stack>
  );
}
