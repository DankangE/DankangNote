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
  const response = await fetch(`/api/notifications${query}`);
  if (!response.ok) {
    return EMPTY_NOTIFICATION_PAGE;
  }
  return (await response.json()) as NotificationPage;
}

export type { NotificationView };
