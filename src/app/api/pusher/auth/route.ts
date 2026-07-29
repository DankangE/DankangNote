import { getAuthState } from '@/server/auth';
import { pusherServer } from '@/server/pusher';
import * as channelService from '@/server/services/channels';
import { channelIdFromPusherChannel } from '@/features/chat/realtime';

// pusher-js가 private 채널 구독 시 POST하는 인증 엔드포인트(form-urlencoded).
// 멀티테넌시 핵심: 요청한 채팅 채널이 현재 세션의 활성 org에 속하고, 비공개라면 내가
// 참여자일 때만 서명한다 — 판정은 DB 조회 하나로, 서비스의 접근 규칙을 그대로 쓴다(KAN-28).
export async function POST(request: Request) {
  const { userId, orgId, isAdmin } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 폼이 아닌 바디는 formData()가 throw한다 — 클라이언트 입력 문제는 400으로.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const socketId = form.get('socket_id');
  const pusherChannel = form.get('channel_name');
  if (typeof socketId !== 'string' || typeof pusherChannel !== 'string') {
    return new Response('Bad Request', { status: 400 });
  }

  const channelId = channelIdFromPusherChannel(pusherChannel);
  // 접근할 수 없는 채널과 존재하지 않는 채널을 같은 403으로 답한다 — 응답 차이로
  // 남의 워크스페이스에 그 id의 채널이 있는지 알아낼 수 없게.
  if (!channelId || !(await channelService.getChannel(orgId, { userId, isAdmin }, channelId))) {
    return new Response('Forbidden', { status: 403 });
  }

  // 키 미설정 확인은 접근 검증 뒤에 둔다 — 테넌트 격리(403)가 설정 상태와 무관하게
  // 항상 같은 결과를 내도록.
  if (!pusherServer) {
    return new Response('Pusher not configured', { status: 503 });
  }

  // socket_id 형식(\d+\.\d+)이 아니면 pusher 라이브러리가 throw — 역시 입력 문제다.
  try {
    return Response.json(pusherServer.authorizeChannel(socketId, pusherChannel));
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
}
