import { getAuthState } from '@/server/auth';
import { pusherServer } from '@/server/pusher';
import * as channelService from '@/server/services/channels';
import { channelRefSchema } from '@/features/chat/api/validation';
import { CHAT_TYPING_EVENT, presenceChannel } from '@/features/chat/realtime';

/**
 * '나 지금 입력 중' 핑 (KAN-34).
 *
 * **Server Action이 아니라 Route Handler다.** 액션은 한 줄로 직렬화돼 순서대로 처리되므로,
 * 글자를 치는 내내 나가는 이 핑을 액션으로 두면 바로 뒤의 전송·읽음 처리가 그만큼 밀린다
 * (이력 조회·멘션 후보를 Route Handler로 둔 것과 같은 이유).
 *
 * Pusher **클라이언트 이벤트**(client-*)를 쓰면 서버를 아예 거치지 않을 수 있지만
 * 그러지 않았다. 대시보드에서 앱마다 따로 켜야 하는 기능이라 꺼져 있으면 조용히 아무 일도
 * 일어나지 않고, 무엇보다 '이 채널을 볼 수 있는가'를 우리가 판정할 자리가 사라진다.
 *
 * 페이로드는 userId 하나뿐이다 — 표시 이름은 이미 프레즌스 멤버 정보로 가 있고, 수신 측이
 * 거기서 찾는다. 이름을 여기 실으면 매 핑마다 Clerk을 다시 읽어야 한다.
 *
 * 핑 간격(TYPING_PING_MS)을 지키는 주체는 아직 클라이언트뿐이다 — 여기를 루프로 때리면
 * Pusher 쿼터를 태울 수 있다. 저장소에 레이트 리밋 기반이 없어 이 라우트만 인메모리로
 * 막으면 인스턴스마다 따로 세어 실효가 없으므로, 공용 헬퍼와 함께 KAN-57에서 다룬다.
 */
export async function POST(request: Request) {
  const { userId, orgId } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const parsed = channelRefSchema.safeParse(body);
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 });
  }

  // 접근 판정은 서비스가 한다 — 볼 수 없는 채널에 입력 중 신호를 흘리면 그 자체가
  // '거기 그런 채널이 있다'는 신호다. 없는 채널과 같은 404로 답한다.
  // 뷰가 아니라 canAccessChannel을 쓰는 이유는 빈도다(그쪽 주석 참조).
  if (!(await channelService.canAccessChannel(orgId, userId, parsed.data.id))) {
    return new Response('Not Found', { status: 404 });
  }

  if (!pusherServer) {
    return new Response('Pusher not configured', { status: 503 });
  }

  try {
    await pusherServer.trigger(presenceChannel(parsed.data.id), CHAT_TYPING_EVENT, { userId });
  } catch (error) {
    // 타이핑 표시는 부가 정보다 — 실패해도 사용자가 할 일이 없으므로 조용히 넘긴다.
    console.error('[chat] typing broadcast failed:', error);
  }
  // 돌려줄 것이 없다. 호출부도 응답을 보지 않는다.
  return new Response(null, { status: 204 });
}
