import { getAuthState } from '@/server/auth';
import * as notificationService from '@/server/services/notifications';
import { notificationPageSchema } from '@/features/notifications/validation';

/**
 * 내 알림 한 페이지 + 안읽음 수 (KAN-32).
 *
 * 이력 조회와 같은 이유로 Server Action이 아니라 Route Handler다 — 액션은 클라이언트당
 * 순차 디스패치라, 알림 패널을 여는 동안 메시지 전송이 큐에서 기다린다.
 *
 * 안읽음 수를 목록과 같은 응답에 싣는 것은 둘이 **같은 가시성 판정**에서 나와야 하기
 * 때문이다. 따로 부르면 그 사이 채널에서 빠졌을 때 '뱃지에는 있는데 열면 없는' 상태가 된다.
 */
export async function GET(request: Request) {
  const { userId, orgId } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const parsed = notificationPageSchema.safeParse({
    before: params.get('before') ?? undefined,
  });
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 });
  }

  const [page, unread] = await Promise.all([
    notificationService.listNotifications(orgId, userId, parsed.data.before),
    notificationService.unreadCount(orgId, userId),
  ]);
  return Response.json({ ...page, unread });
}
