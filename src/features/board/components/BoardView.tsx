import type { BoardView as BoardData } from '@/features/board/types';
import { BoardClient } from './BoardClient';

// 서버 컴포넌트 — 정적 헤더만 두고 상호작용·상태는 BoardClient(클라이언트 경계)에 위임한다.
// 보드는 컬럼 가로 스크롤이 필요해 노트처럼 좁게 가운데 정렬(CenteredPage)하지 않는다.
export function BoardView({ board }: { board: BoardData }) {
  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">보드</h1>
        <p className="text-muted-foreground">워크스페이스의 칸반 보드</p>
      </div>
      <BoardClient initialBoard={board} />
    </div>
  );
}
