import { auth } from '@clerk/nextjs/server';
import { fetchBoard } from '@/features/board/api/queries';
import { NoOrganization } from '@/lib/components/NoOrganization';
import { BoardView } from '@/features/board/components/BoardView';

export default async function BoardPage() {
  // auth.protect()는 미인증이면 sign-in으로 redirect하고, 인증되면 auth 객체를 반환한다.
  const { orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  const board = await fetchBoard();
  return <BoardView board={board} />;
}
