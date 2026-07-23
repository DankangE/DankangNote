// 채널·이벤트 이름의 단일 정의 — 서버(트리거·채널 인증)와 클라이언트(구독)가 공유한다.
// 비밀이 없는 순수 문자열 유틸이므로 server-only를 붙이지 않는다.

const ORG_CHANNEL_PREFIX = 'private-org-';

export const CHAT_MESSAGE_EVENT = 'chat:message';

export function orgChannel(orgId: string): string {
  return `${ORG_CHANNEL_PREFIX}${orgId}`;
}

// 채널 인증 요청의 채널명에서 orgId를 복원한다. 우리 규칙 밖의 채널이면 null.
export function orgIdFromChannel(channelName: string): string | null {
  if (!channelName.startsWith(ORG_CHANNEL_PREFIX)) {
    return null;
  }
  return channelName.slice(ORG_CHANNEL_PREFIX.length) || null;
}
