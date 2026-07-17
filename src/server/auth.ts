import 'server-only';

import { auth } from '@clerk/nextjs/server';

/**
 * 현재 요청 사용자의 워크스페이스(orgId)를 반환한다.
 * 모든 Server Action / 조회는 진입부에서 이 헬퍼를 거쳐야 한다.
 *
 * 미인증이거나 활성 조직이 없으면 throw한다 — Server Action은 guarded가 잡아
 * ActionResult 실패로 변환하고, 페이지는 조직 유무를 미리 분기해 이 예외를 피한다.
 */
export async function requireOrgId(): Promise<string> {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('워크스페이스(조직)를 선택하거나 만들어야 합니다.');
  }
  return orgId;
}
