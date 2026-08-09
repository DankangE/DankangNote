// 공동 편집 채널·이벤트 이름의 단일 정의 (KAN-39) — 서버(트리거·채널 인증)와
// 클라이언트(구독)가 공유한다. 비밀이 없는 순수 문자열 유틸이라 server-only를 안 붙인다.
//
// 채팅과 달리 **문서 단위**다. 노트는 org 전체 공개지만 그렇다고 org 채널로 쏘면 열어 두지도
// 않은 문서의 타건이 전원에게 흐른다 — 공동 편집은 초당 수십 건이라 그 낭비가 채팅과
// 비교가 안 된다(KAN-28이 org 단위에서 채널 단위로 내린 것과 같은 이유, 규모만 다르다).

const NOTE_DOC_CHANNEL_PREFIX = 'private-note-';

// 커서·접속자(awareness)는 문서 채널과 **따로** 둔다 (KAN-75) — 규약 22가 채팅에서 세운
// 것과 같은 이유이고, 여기서는 셋이 더 강하게 갈린다.
// ① 수명이 다르다 — 문서 델타는 저장되는 값이고 awareness는 접속 중에만 사는 값이다.
// ② 경로가 다르다 — 델타는 서버를 거쳐 저장·브로드캐스트되지만 커서는 클라이언트끼리
//    직접 오간다(아래 NOTE_AWARENESS_EVENT 주석). 한 채널에 섞으면 저장되는 것과
//    안 되는 것이 같은 이름으로 흘러 수신 측이 페이로드 모양으로 갈라야 한다.
// ③ 실패의 무게가 다르다 — 프레즌스 채널에는 멤버 상한이 있어 거절될 수 있다.
//    합쳐 두면 그 순간 본문 동기화까지 함께 죽는다.
const NOTE_PRESENCE_CHANNEL_PREFIX = 'presence-note-';

/** 다른 편집자의 Yjs 업데이트. 페이로드는 base64로 감싼 델타다. */
export const NOTE_DOC_UPDATE_EVENT = 'note:update';

/**
 * '델타로는 못 보냈으니 다시 받아 가라'. Pusher 메시지 상한(10KB)을 넘는 업데이트가 있다 —
 * 이미지가 든 문단을 통째로 붙여넣는 경우가 대표적이다. 그때 델타를 쪼개 보내는 대신
 * 신호만 쏘고 각자 스냅샷을 다시 받게 한다: 쪼개면 순서·유실 처리를 우리가 떠안는데,
 * 그건 CRDT가 이미 푼 문제를 전송 계층에서 다시 푸는 일이다.
 */
export const NOTE_DOC_RESYNC_EVENT = 'note:resync';

/**
 * 커서·선택 범위(Yjs awareness). **`client-` 접두사라 서버를 거치지 않고 브라우저끼리
 * 직접 오간다** (KAN-75).
 *
 * 규약 22는 "클라이언트가 직접 쏘는 이벤트 대신 서버를 거치게 두면 판정할 자리가 남는다"
 * 고 했다. 그건 판정할 자리가 **구독 시점에 없을 때**의 이야기다 — 여기서는 프레즌스 채널
 * 구독 자체가 `/api/pusher/auth`의 서명을 받으므로 게이트가 이미 서 있고, Pusher가
 * 클라이언트 이벤트에 그 서명에서 나온 `user_id`를 붙여 배달한다(수신 측은 그 값만 믿는다).
 *
 * 서버를 거치게 두면 잃는 게 크다: 커서는 타건·클릭마다 움직여 초당 수십 건이라
 * KAN-57의 레이트 리밋과 정면으로 부딪히고, 왕복 지연이 그대로 커서 지연이 되며,
 * 저장할 이유가 전혀 없는 값이 저장 경로를 지나간다.
 *
 * **Pusher 대시보드에서 client events를 켜야 동작한다.** 꺼져 있으면 커서만 안 보이고
 * 본문 동기화·접속자 목록은 그대로다.
 */
export const NOTE_AWARENESS_EVENT = 'client-note:awareness';

export function noteDocChannel(noteId: string): string {
  return `${NOTE_DOC_CHANNEL_PREFIX}${noteId}`;
}

export function notePresenceChannel(noteId: string): string {
  return `${NOTE_PRESENCE_CHANNEL_PREFIX}${noteId}`;
}

/** 채널 인증 요청의 채널명에서 노트 id를 복원한다. 우리 규칙 밖이면 null. */
export function noteIdFromPusherChannel(pusherChannel: string): string | null {
  if (!pusherChannel.startsWith(NOTE_DOC_CHANNEL_PREFIX)) {
    return null;
  }
  return pusherChannel.slice(NOTE_DOC_CHANNEL_PREFIX.length) || null;
}

/**
 * 프레즌스 채널 이름에서 노트 id를 복원한다. 접두사가 서로의 접두사가 아니므로
 * (private-note- / presence-note-) 두 복원 함수는 겹치지 않는다.
 */
export function noteIdFromPresenceChannel(pusherChannel: string): string | null {
  if (!pusherChannel.startsWith(NOTE_PRESENCE_CHANNEL_PREFIX)) {
    return null;
  }
  return pusherChannel.slice(NOTE_PRESENCE_CHANNEL_PREFIX.length) || null;
}

/**
 * Pusher 이벤트에 실을 수 있는 base64 업데이트의 상한. Pusher의 메시지 상한이 10KB라
 * 여유를 두고 잡는다 — 넘으면 재동기화 신호로 대체한다.
 */
export const MAX_BROADCAST_UPDATE_BYTES = 8 * 1024;

/** 한 요청이 실어 올 수 있는 업데이트 상한 — 브로드캐스트 상한과 별개로 저장도 묶는다. */
export const MAX_DOC_UPDATE_BYTES = 512 * 1024;
