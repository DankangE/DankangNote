import 'server-only';

import { auth } from '@clerk/nextjs/server';

/**
 * 현재 요청 사용자의 활성 워크스페이스(orgId). 미인증이거나 활성 조직이 없으면 null.
 * 액션·페이지 진입부는 이 헬퍼로 명시적으로 분기해 사용자에게 맞는 안내를 준다
 * (throw 대신 반환값으로 처리 — 정상적인 '조직 없음' 상태를 예외로 취급하지 않는다).
 */
export async function getOrgId(): Promise<string | null> {
  const { orgId } = await auth();
  return orgId ?? null;
}

/**
 * orgId를 필수로 요구한다 — 없으면 throw. orgId가 반드시 있어야 하는 조회 헬퍼 등의
 * 방어선이다. 정상 흐름에선 진입부의 getOrgId 분기에서 이미 걸러진다.
 */
export async function requireOrgId(): Promise<string> {
  const orgId = await getOrgId();
  if (!orgId) {
    throw new Error('워크스페이스(조직)를 선택하거나 만들어야 합니다.');
  }
  return orgId;
}
