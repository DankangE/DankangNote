// 채널·이벤트 이름의 단일 정의 — 서버(트리거·채널 인증)와 클라이언트(구독)가 공유한다.
// 비밀이 없는 순수 문자열 유틸이므로 server-only를 붙이지 않는다.
//
// KAN-28에서 org 단위(private-org-<orgId>)에서 채팅 채널 단위로 내렸다. 비공개 채널의
// 메시지가 조직 전체에 브로드캐스트되면 DB 격리를 아무리 잘 해도 실시간 경로로 새기 때문이다.

const CHAT_CHANNEL_PREFIX = 'private-chat-';

// 프레즌스는 메시지 채널과 **따로** 둔다(KAN-34). 같은 채널을 presence-로 승격하면
// 한 구독으로 끝나 얼핏 싸 보이지만 셋이 어긋난다.
// ① 대상이 다르다 — 메시지 수신자는 '이 채널의 참여자'고, 프레즌스는 '지금 이 채널을
//    열어 두고 보고 있는 사람'이다. 안읽음 훅(use-channel-unread)은 내 채널 **전부**를
//    구독하는데, 그게 프레즌스면 열어 보지도 않은 채널마다 내가 접속 중으로 뜬다.
// ② 실패의 무게가 다르다 — 프레즌스 채널에는 멤버 수 상한이 있어 붐비는 채널에서
//    구독이 거절될 수 있다. 하나로 합쳐 두면 그때 메시지 배달까지 함께 죽는다.
// ③ 프레즌스는 구독자 목록을 서로에게 공개한다. 열어 둔 사람만 담기게 범위를 좁혀 둔다.
const PRESENCE_CHANNEL_PREFIX = 'presence-chat-';

export const CHAT_MESSAGE_EVENT = 'chat:message';
// 리액션은 메시지와 다른 이벤트로 쏜다(KAN-31) — 같은 이벤트에 실으면 수신 측이 페이로드
// 모양으로 종류를 갈라야 하고, 메시지 핸들러가 리액션 때문에 목록을 다시 접게 된다.
export const CHAT_REACTION_EVENT = 'chat:reaction';

// 타이핑은 프레즌스 채널로 흐른다 — 보고 있지 않은 사람에게 보낼 이유가 없고, 수신 측이
// 이름을 프레즌스 멤버 목록에서 찾기 때문에 페이로드에 userId만 실으면 된다(KAN-34).
export const CHAT_TYPING_EVENT = 'chat:typing';

export function chatChannel(channelId: string): string {
  return `${CHAT_CHANNEL_PREFIX}${channelId}`;
}

export function presenceChannel(channelId: string): string {
  return `${PRESENCE_CHANNEL_PREFIX}${channelId}`;
}

// 채널 인증 요청의 Pusher 채널명에서 채팅 채널 id를 복원한다. 우리 규칙 밖이면 null.
export function channelIdFromPusherChannel(pusherChannel: string): string | null {
  if (!pusherChannel.startsWith(CHAT_CHANNEL_PREFIX)) {
    return null;
  }
  return pusherChannel.slice(CHAT_CHANNEL_PREFIX.length) || null;
}

// 프레즌스 채널 이름에서 채팅 채널 id를 복원한다. 접두사가 서로의 접두사가 아니므로
// (private-chat- / presence-chat-) 두 복원 함수는 겹치지 않는다.
export function channelIdFromPresenceChannel(pusherChannel: string): string | null {
  if (!pusherChannel.startsWith(PRESENCE_CHANNEL_PREFIX)) {
    return null;
  }
  return pusherChannel.slice(PRESENCE_CHANNEL_PREFIX.length) || null;
}
