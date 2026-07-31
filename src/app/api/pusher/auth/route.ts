import { getAuthState } from '@/server/auth';
import { pusherServer } from '@/server/pusher';
import * as channelService from '@/server/services/channels';
import { channelIdFromPusherChannel } from '@/features/chat/realtime';
import { notificationTargetFromChannel } from '@/features/notifications/realtime';

/**
 * 이 세션이 이 Pusher 채널을 구독해도 되는가. 채널 종류마다 판정이 다르다.
 *
 * 접근할 수 없는 것과 존재하지 않는 것을 구분하지 않는다(전부 false) — 응답이 갈리면
 * 남의 워크스페이스에 그 id의 채널이 있는지 알아내는 오라클이 된다.
 */
async function maySubscribe(
  pusherChannel: string,
  session: { orgId: string; userId: string; isAdmin: boolean },
): Promise<boolean> {
  // 알림은 사람 단위 채널이라 DB를 볼 것도 없다 — 내 org·내 id의 채널만 서명한다(KAN-32).
  const target = notificationTargetFromChannel(pusherChannel);
  if (target) {
    return target.orgId === session.orgId && target.userId === session.userId;
  }

  const channelId = channelIdFromPusherChannel(pusherChannel);
  if (!channelId) {
    return false;
  }
  const { orgId, ...actor } = session;
  return Boolean(await channelService.getChannel(orgId, actor, channelId));
}

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

  if (!(await maySubscribe(pusherChannel, { orgId, userId, isAdmin }))) {
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
