import 'server-only';

// Clerk 도입 전까지 모든 데이터가 속할 임시 워크스페이스.
const DEV_ORG_ID = 'org_dev';

/**
 * 현재 요청 사용자의 워크스페이스(orgId)를 반환한다.
 * 모든 Server Action / Route Handler는 진입부에서 이 헬퍼를 거쳐야 한다.
 *
 * TODO(Clerk): 도입 후 clerk의 auth()에서 orgId를 읽고, 미인증이면 throw 하도록 교체.
 */
export async function requireOrgId(): Promise<string> {
  return DEV_ORG_ID;
}
