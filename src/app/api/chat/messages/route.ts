import { getAuthState } from '@/server/auth';
import * as chatService from '@/server/services/chat';
import { olderMessagesSchema } from '@/features/chat/api/validation';

/**
 * 채널 이력 한 페이지(KAN-29). 변이가 아니므로 Server Action이 아니라 Route Handler다 —
 * Next는 Server Action을 클라이언트당 한 번에 하나씩 디스패치하므로(01-app/02-guides/
 * server-actions.md), 이력 로딩을 액션으로 두면 그 사이의 메시지 전송이 50건 조회가 끝날
 * 때까지 큐에서 기다린다. 채팅에서 그 지연은 그대로 체감된다.
 *
 * 권한은 서비스가 한다 — 접근할 수 없는 채널이면 listMessages가 빈 페이지를 돌려주므로,
 * 이 핸들러가 별도의 접근 규칙을 갖지 않는다(KAN-28: 접근 판정은 한 개의 where).
 */
export async function GET(request: Request) {
  const { userId, orgId } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const parsed = olderMessagesSchema.safeParse({
    channelId: params.get('channelId'),
    before: params.get('before'),
  });
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 });
  }

  const page = await chatService.listMessages(
    orgId,
    userId,
    parsed.data.channelId,
    parsed.data.before,
  );
  return Response.json(page);
}
