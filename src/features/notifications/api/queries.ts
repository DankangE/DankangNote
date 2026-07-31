import type { NotificationView } from '@/server/services/notifications';

// 알림 조회는 Route Handler를 쓴다(이유는 app/api/notifications/route.ts).
// 실패는 던지지 않고 빈 상태를 준다 — 알림은 부가 기능이라 화면을 막을 이유가 없다.

export type NotificationPage = {
  notifications: NotificationView[];
  hasMore: boolean;
  unread: number;
};

export const EMPTY_NOTIFICATION_PAGE: NotificationPage = {
  notifications: [],
  hasMore: false,
  unread: 0,
};

export async function fetchNotifications(before?: string): Promise<NotificationPage> {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  try {
    const response = await fetch(`/api/notifications${query}`);
    if (!response.ok) {
      return EMPTY_NOTIFICATION_PAGE;
    }
    return (await response.json()) as NotificationPage;
  } catch {
    // 네트워크 자체가 끊기면 fetch는 reject한다. 그대로 두면 호출부(NotificationBell)의
    // refresh가 unhandled rejection으로 끝나고, 이미 올려 둔 요청 세대 때문에 뒤늦게
    // 도착한 정상 응답까지 버려져 종이 영구히 '불러오는 중'에 멈춘다.
    return EMPTY_NOTIFICATION_PAGE;
  }
}

export type { NotificationView };
