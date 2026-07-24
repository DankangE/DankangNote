import 'server-only';

import { requireOrgId } from '@/server/auth';
import * as boardService from '@/server/services/board';
import type { BoardView } from '@/features/board/types';

// 서버 컴포넌트가 직접 호출하는 조회 헬퍼. orgId 스코프를 스스로 붙여 타 워크스페이스가
// 새지 않게 한다(notes/chat과 동일).
export async function fetchBoard(): Promise<BoardView> {
  const orgId = await requireOrgId();
  return boardService.listBoard(orgId);
}
