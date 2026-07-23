import 'server-only';

import { requireOrgId } from '@/server/auth';
import * as workspaceService from '@/server/services/workspace';
import type { WorkspaceMember } from '@/features/workspace/types';

// 서버 컴포넌트에서 직접 호출하는 조회 헬퍼.
// notes와 동일하게 orgId 스코프를 스스로 붙인다(자기 스코프 보장).

export async function fetchMembers(): Promise<WorkspaceMember[]> {
  const orgId = await requireOrgId();
  return workspaceService.listMembers(orgId);
}
