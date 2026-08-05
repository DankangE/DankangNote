import { getAuthState } from '@/server/auth';
import { pusherServer } from '@/server/pusher';
import * as channelService from '@/server/services/channels';
import { allowOnceEvery } from '@/server/services/rate-limit';
import { channelRefSchema } from '@/features/chat/api/validation';
import { TYPING_PING_MS } from '@/features/chat/presence';
import { CHAT_TYPING_EVENT, presenceChannel } from '@/features/chat/realtime';

// 서버가 강제하는 최소 간격은 클라이언트 핑 간격에서 파생하되 짧게 잡는다 — 걸러야 할
// 것은 초당 수십 건의 루프이지, 네트워크 지터로 2.5초짜리 연속 핑이 압축돼 도착한 정상
// 클라이언트가 아니다. 상수를 따로 적지 않고 파생하는 이유: 클라이언트 간격을 조정할 때
// 이 값이 따라오지 않으면 정상 트래픽이 리밋에 걸리는 사고가 조용히 생긴다.
const TYPING_MIN_INTERVAL_MS = TYPING_PING_MS * 0.8;

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
 * 핑 간격은 서버도 강제한다(KAN-57) — 클라이언트 스로틀만 믿으면 fetch 루프 한 줄이
 * Pusher 쿼터를 태우고 같은 채널 화면 전부에 이벤트를 꽂는다. 판정은 인스턴스 간 공유되는
 * allowOnceEvery(DB 한 문장)가 한다 — 인메모리 카운터는 서버리스 인스턴스마다 따로 세어
 * 실효가 없다.
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

  // 미설정 검사가 리밋보다 앞이다 — 보낼 곳이 없는 핑이 RateLimit 행을 쓰는 것도,
  // 그 구성에서만 허용=503·거부=204로 갈려 상태 코드가 리밋 여부를 알리는 것도 막는다.
  if (!pusherServer) {
    return new Response('Pusher not configured', { status: 503 });
  }

  // 리밋 키는 채널이 아니라 사람이다 — 채널 단위 키는 상한을 '사용자 × 채널당 1건'으로
  // 만들어, 채널을 바꿔 가며 도는 루프(생성에 상한이 없다)가 지키려던 Pusher 쿼터를
  // 그대로 태운다. 사람은 한 번에 한 채널에서만 입력하므로 사용자당 1건이 곧 의도한
  // 상한이다. 두 채널을 동시에 연 멀티탭은 한쪽 핑이 걸러질 수 있지만, 타이핑 표시는
  // 부가 정보고 수신 측 TTL이 다음 핑까지 대부분 덮는다.
  //
  // 키가 정적('typing')이라 유계이므로 접근 판정 **앞**에 둘 수 있다(rate-limit.ts 계약)
  // — 스프레이가 행을 늘릴 수 없고, 리밋에 걸린 요청은 채널 조회 비용도 내지 않는다.
  // 초과 응답이 429가 아니라 조용한 204인 것은 의도다: 타이핑 표시는 부가 정보라 정상
  // 클라이언트는 응답을 보지 않고, 상태 코드로 리밋 여부를 구분해 줘 봐야 루프를 도는
  // 쪽에 신호만 준다.
  if (!(await allowOnceEvery(TYPING_MIN_INTERVAL_MS, userId, 'typing'))) {
    return new Response(null, { status: 204 });
  }

  // 접근 판정은 서비스가 한다 — 볼 수 없는 채널에 입력 중 신호를 흘리면 그 자체가
  // '거기 그런 채널이 있다'는 신호다. 없는 채널과 같은 404로 답한다.
  // 뷰가 아니라 canAccessChannel을 쓰는 이유는 빈도다(그쪽 주석 참조).
  if (!(await channelService.canAccessChannel(orgId, userId, parsed.data.id))) {
    return new Response('Not Found', { status: 404 });
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
