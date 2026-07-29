import { getAuthState } from '@/server/auth';
import * as chatService from '@/server/services/chat';
import { threadSchema } from '@/features/chat/api/validation';

/**
 * 스레드 한 건(루트 + 답글 페이지, KAN-30). 이력 조회와 같은 이유로 Server Action이
 * 아니라 Route Handler다 — 액션은 클라이언트당 순차 디스패치라, 스레드를 여는 동안
 * 메시지 전송이 큐에서 기다리게 된다(app/api/chat/messages/route.ts 주석 참조).
 *
 * 접근 판정은 서비스가 한다. 볼 수 없는 스레드와 없는 스레드를 같은 404로 답한다 —
 * 응답이 갈리면 그 자체로 '그 id의 메시지가 있는지' 알려주는 오라클이 된다.
 */
export async function GET(request: Request) {
  const { userId, orgId } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const parsed = threadSchema.safeParse({
    rootId: params.get('rootId'),
    before: params.get('before') ?? undefined,
  });
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 });
  }

  const thread = await chatService.listThread(
    orgId,
    userId,
    parsed.data.rootId,
    parsed.data.before,
  );
  if (!thread) {
    return new Response('Not Found', { status: 404 });
  }
  return Response.json(thread);
}
