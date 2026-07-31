// 채널·이벤트 이름의 단일 정의 — 서버(트리거·채널 인증)와 클라이언트(구독)가 공유한다.
// 비밀이 없는 순수 문자열 유틸이므로 server-only를 붙이지 않는다.
//
// KAN-28에서 org 단위(private-org-<orgId>)에서 채팅 채널 단위로 내렸다. 비공개 채널의
// 메시지가 조직 전체에 브로드캐스트되면 DB 격리를 아무리 잘 해도 실시간 경로로 새기 때문이다.

const CHAT_CHANNEL_PREFIX = 'private-chat-';

export const CHAT_MESSAGE_EVENT = 'chat:message';
// 리액션은 메시지와 다른 이벤트로 쏜다(KAN-31) — 같은 이벤트에 실으면 수신 측이 페이로드
// 모양으로 종류를 갈라야 하고, 메시지 핸들러가 리액션 때문에 목록을 다시 접게 된다.
export const CHAT_REACTION_EVENT = 'chat:reaction';

export function chatChannel(channelId: string): string {
  return `${CHAT_CHANNEL_PREFIX}${channelId}`;
}

// 채널 인증 요청의 Pusher 채널명에서 채팅 채널 id를 복원한다. 우리 규칙 밖이면 null.
export function channelIdFromPusherChannel(pusherChannel: string): string | null {
  if (!pusherChannel.startsWith(CHAT_CHANNEL_PREFIX)) {
    return null;
  }
  return pusherChannel.slice(CHAT_CHANNEL_PREFIX.length) || null;
}
