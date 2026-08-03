import 'server-only';

import { auth, currentUser } from '@clerk/nextjs/server';

// '조직 없음' 상태의 사용자 안내 문구 — 액션·조회 헬퍼가 공유한다.
export const NO_ORG_ERROR = '워크스페이스(조직)를 선택하거나 만들어야 합니다.';

export const NOT_SIGNED_IN_ERROR = '로그인이 필요합니다. 다시 로그인해 주세요.';

/**
 * 현재 요청의 인증 상태. userId/orgId를 그대로 노출해 호출부가 '미인증'과
 * '활성 조직 없음'을 구분할 수 있게 한다(둘을 null 하나로 뭉개지 않는다).
 * isAdmin은 현재 조직에서 관리자 역할인지 — 권한 강제(KAN-18)의 근거다.
 */
export async function getAuthState(): Promise<{
  userId: string | null;
  orgId: string | null;
  isAdmin: boolean;
}> {
  const authObject = await auth();
  // 역할은 Clerk 세션 클레임(has)으로만 판단한다 — DB 미러 Membership.role은 웹훅 지연·순서
  // 역전으로 stale할 수 있어 authz에 쓰면 안 된다(KAN-18 원칙, KAN-12 참조). 미러 role은 표시용.
  const isAdmin = authObject.userId ? authObject.has({ role: 'org:admin' }) : false;
  return { userId: authObject.userId ?? null, orgId: authObject.orgId ?? null, isAdmin };
}

/**
 * 현재 사용자의 활성 워크스페이스(orgId). 없으면 null (throw 없음).
 */
export async function getOrgId(): Promise<string | null> {
  const { orgId } = await getAuthState();
  return orgId;
}

/**
 * 액션 진입부의 인증·조직 게이트. 미인증('로그인 필요')과 조직 없음(워크스페이스
 * 안내)을 구분해 사용자에게 맞는 문구를 준다. 여러 feature 액션이 공유한다.
 */
export async function resolveOrg(): Promise<
  { userId: string; orgId: string; isAdmin: boolean } | { error: string }
> {
  const { userId, orgId, isAdmin } = await getAuthState();
  if (!userId) {
    return { error: NOT_SIGNED_IN_ERROR };
  }
  if (!orgId) {
    return { error: NO_ORG_ERROR };
  }
  return { userId, orgId, isAdmin };
}

/**
 * RSC가 노트 편집·삭제 버튼 노출을 결정할 때 쓰는 뷰어 컨텍스트. 서버 권한 강제가 본선이고
 * 이건 UI 편의일 뿐이다(backend.md). 미인증/무조직이면 null.
 */
export async function getViewer(): Promise<{ userId: string; isAdmin: boolean } | null> {
  const { userId, orgId, isAdmin } = await getAuthState();
  if (!userId || !orgId) {
    return null;
  }
  return { userId, isAdmin };
}

/**
 * 화면에 보일 내 표시 정보(이름·아바타).
 *
 * 미러 테이블(User)이 아니라 Clerk 세션에서 직접 읽는다 — 미러는 웹훅으로만 채워져
 * 가입 직후엔 빈 행이고, 그러면 내가 보낸 말풍선에만 내 이름이 id로 뜬다.
 *
 * 낙관 말풍선(ChatViewer)과 프레즌스 멤버 정보가 이 하나를 공유해야 한다. 각자 계산하면
 * 같은 사람이 메시지에는 '단 강', 접속자 목록에는 이메일로 뜨는 화면이 나온다.
 * 이름 규칙은 미러용 displayName(user-display.ts)과 같다.
 *
 * **못 읽으면 던지지 않고 null이다.** 이건 표시용 정보라 호출부마다 폴백이 이미 있는데,
 * currentUser()는 Clerk Backend API 호출이고 그 실패를 그대로 다시 던진다 — 그러면 프레즌스
 * 채널 인증이 500이 되고, pusher-js는 실패한 채널 인증을 재시도하지 않아 그 세션의 접속자
 * 목록이 소켓이 다시 붙을 때까지 빈 채로 남는다. 이름 하나 때문에 잃을 것이 아니다.
 */
export async function getViewerIdentity(): Promise<{
  id: string;
  name: string;
  imageUrl: string | null;
} | null> {
  const user = await currentUser().catch((error: unknown) => {
    console.error('[auth] currentUser lookup failed:', error);
    return null;
  });
  if (!user) {
    return null;
  }
  const email = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)
    ?.emailAddress;
  return {
    id: user.id,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || email || user.id,
    imageUrl: user.imageUrl || null,
  };
}

/**
 * resolveOrg의 throw 버전 — 서버 컴포넌트 조회 헬퍼용. 사용자·조직·역할이 모두 필요한
 * 조회(예: 채널 목록은 '내가 참여 중인지'까지 계산한다)가 쓴다. 정상 흐름에선 페이지
 * 진입부의 auth.protect()가 이미 걸러낸다.
 */
export async function requireOrg(): Promise<{ userId: string; orgId: string; isAdmin: boolean }> {
  const org = await resolveOrg();
  if ('error' in org) {
    throw new Error(org.error);
  }
  return org;
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
