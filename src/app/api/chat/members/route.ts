import { getAuthState } from '@/server/auth';
import * as channelMemberService from '@/server/services/channel-members';
import { channelRefSchema } from '@/features/chat/api/validation';

/**
 * 멘션 후보 = 이 채널의 참여자 (KAN-32).
 *
 * 조직 멤버 전체가 아니라 참여자로 한정한다. 채널에 없는 사람을 부르면 공개 채널에서는
 * 알림이 가지만 비공개 채널에서는 가시성 판정에 걸려 사라진다 — '불렀는데 아무 일도 안
 * 일어나는' 경로가 생기느니 애초에 후보에 넣지 않는다(슬랙은 초대를 권하는데, 그건
 * 채널 초대 UX와 묶이는 별개 작업이다).
 *
 * 이력 조회와 같은 이유로 Route Handler다 — 컴포저에서 '@'를 칠 때마다 액션 큐를 쓰면
 * 그 뒤의 전송이 밀린다. 접근 판정은 서비스가 하고, 못 보는 채널이면 null → 404다.
 */
export async function GET(request: Request) {
  const { userId, orgId } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const parsed = channelRefSchema.safeParse({
    id: new URL(request.url).searchParams.get('channelId'),
  });
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 });
  }

  const members = await channelMemberService.listChannelMembers(orgId, userId, parsed.data.id);
  if (!members) {
    return new Response('Not Found', { status: 404 });
  }
  return Response.json(members);
}
