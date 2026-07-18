import 'server-only';

import { auth } from '@clerk/nextjs/server';

// '조직 없음' 상태의 사용자 안내 문구 — 액션·조회 헬퍼가 공유한다.
export const NO_ORG_ERROR = '워크스페이스(조직)를 선택하거나 만들어야 합니다.';

/**
 * 현재 요청의 인증 상태. userId/orgId를 그대로 노출해 호출부가 '미인증'과
 * '활성 조직 없음'을 구분할 수 있게 한다(둘을 null 하나로 뭉개지 않는다).
 */
export async function getAuthState(): Promise<{ userId: string | null; orgId: string | null }> {
  const { userId, orgId } = await auth();
  return { userId: userId ?? null, orgId: orgId ?? null };
}

/**
 * 현재 사용자의 활성 워크스페이스(orgId). 없으면 null (throw 없음).
 */
export async function getOrgId(): Promise<string | null> {
  const { orgId } = await getAuthState();
  return orgId;
}

/**
 * orgId를 필수로 요구한다 — 없으면 throw. orgId가 반드시 있어야 하는 조회 헬퍼 등의
 * 방어선이다. 정상 흐름에선 진입부에서 이미 걸러진다.
 */
export async function requireOrgId(): Promise<string> {
  const orgId = await getOrgId();
  if (!orgId) {
    throw new Error(NO_ORG_ERROR);
  }
  return orgId;
}
