import { getAuthState } from '@/server/auth';
import { pusherServer } from '@/server/pusher';
import { orgIdFromChannel } from '@/features/chat/realtime';

// pusher-js가 private 채널 구독 시 POST하는 인증 엔드포인트(form-urlencoded).
// 멀티테넌시 핵심: 요청 채널의 orgId가 현재 세션의 활성 org와 일치할 때만 서명한다.
export async function POST(request: Request) {
  const { userId, orgId } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const socketId = form.get('socket_id');
  const channelName = form.get('channel_name');
  if (typeof socketId !== 'string' || typeof channelName !== 'string') {
    return new Response('Bad Request', { status: 400 });
  }

  if (orgIdFromChannel(channelName) !== orgId) {
    return new Response('Forbidden', { status: 403 });
  }

  // 키 미설정 확인은 org 검증 뒤에 둔다 — 테넌트 격리(403)가 설정 상태와 무관하게
  // 항상 같은 결과를 내도록.
  if (!pusherServer) {
    return new Response('Pusher not configured', { status: 503 });
  }

  return Response.json(pusherServer.authorizeChannel(socketId, channelName));
}
