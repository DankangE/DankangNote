import { getAuthState } from '@/server/auth';
import * as channelReadService from '@/server/services/channel-reads';

/**
 * 내 채널들의 안읽음 수 (KAN-33).
 *
 * 사이드바는 페이지를 연 시점의 서버 값을 시드로 두고 실시간 메시지로 올린다. 그런데
 * 레이아웃은 채널을 옮겨도 다시 돌지 않으므로(Next: 이동만으로 layout은 재렌더되지 않는다)
 * **세션 중에는 서버와 다시 맞출 기회가 없다** — 소켓이 잠깐 끊긴 사이에 온 메시지는
 * 뱃지에서 영영 빠진다. 재연결·탭 복귀 때 이걸 불러 스스로 맞춘다.
 *
 * 이력 조회와 같은 이유로 Server Action이 아니라 Route Handler다(액션은 클라이언트당
 * 순차 디스패치라 그 사이 전송이 밀린다). 접근 판정은 서비스가 하고, 참여한 채널만 센다.
 */
export async function GET() {
  const { userId, orgId } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const counts = await channelReadService.unreadCounts(orgId, userId);
  return Response.json(Object.fromEntries(counts));
}
