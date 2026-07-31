// 알림 실시간 채널의 단일 정의 (KAN-32). 서버(트리거·채널 인증)와 클라이언트(구독)가 공유한다.
//
// 채팅과 달리 **사람** 단위 채널이다 — 알림은 그 사람만 봐야 하고, 채널 단위로 쏘면
// 같은 채널의 다른 사람에게도 '누가 불렸는지'가 새어 나간다.
//
// 채널 이름에 orgId를 함께 넣는 이유: 한 사람이 여러 워크스페이스에 속할 수 있고, 알림은
// 워크스페이스 단위다. userId만으로 채널을 만들면 A에서 일한 알림이 B를 보고 있을 때
// 뱃지를 올린다(그리고 그 발췌는 B의 화면에 보일 것이 아니다).

const NOTIFICATION_CHANNEL_PREFIX = 'private-notif-';

export const NOTIFICATION_EVENT = 'notification:new';

export function notificationChannel(orgId: string, userId: string): string {
  return `${NOTIFICATION_CHANNEL_PREFIX}${orgId}__${userId}`;
}

/**
 * 채널 인증 요청의 이름에서 (orgId, userId)를 복원한다. 우리 규칙 밖이면 null.
 * 구분자를 `__`로 둔 것은 Clerk id(org_..., user_...)에 밑줄 하나가 이미 들어 있기 때문이다.
 */
export function notificationTargetFromChannel(
  pusherChannel: string,
): { orgId: string; userId: string } | null {
  if (!pusherChannel.startsWith(NOTIFICATION_CHANNEL_PREFIX)) {
    return null;
  }
  const rest = pusherChannel.slice(NOTIFICATION_CHANNEL_PREFIX.length);
  const separator = rest.indexOf('__');
  if (separator <= 0) {
    return null;
  }
  const orgId = rest.slice(0, separator);
  const userId = rest.slice(separator + 2);
  return orgId && userId ? { orgId, userId } : null;
}
