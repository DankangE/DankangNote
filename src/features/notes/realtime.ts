// 공동 편집 채널·이벤트 이름의 단일 정의 (KAN-39) — 서버(트리거·채널 인증)와
// 클라이언트(구독)가 공유한다. 비밀이 없는 순수 문자열 유틸이라 server-only를 안 붙인다.
//
// 채팅과 달리 **문서 단위**다. 노트는 org 전체 공개지만 그렇다고 org 채널로 쏘면 열어 두지도
// 않은 문서의 타건이 전원에게 흐른다 — 공동 편집은 초당 수십 건이라 그 낭비가 채팅과
// 비교가 안 된다(KAN-28이 org 단위에서 채널 단위로 내린 것과 같은 이유, 규모만 다르다).

const NOTE_DOC_CHANNEL_PREFIX = 'private-note-';

/** 다른 편집자의 Yjs 업데이트. 페이로드는 base64로 감싼 델타다. */
export const NOTE_DOC_UPDATE_EVENT = 'note:update';

/**
 * '델타로는 못 보냈으니 다시 받아 가라'. Pusher 메시지 상한(10KB)을 넘는 업데이트가 있다 —
 * 이미지가 든 문단을 통째로 붙여넣는 경우가 대표적이다. 그때 델타를 쪼개 보내는 대신
 * 신호만 쏘고 각자 스냅샷을 다시 받게 한다: 쪼개면 순서·유실 처리를 우리가 떠안는데,
 * 그건 CRDT가 이미 푼 문제를 전송 계층에서 다시 푸는 일이다.
 */
export const NOTE_DOC_RESYNC_EVENT = 'note:resync';

export function noteDocChannel(noteId: string): string {
  return `${NOTE_DOC_CHANNEL_PREFIX}${noteId}`;
}

/** 채널 인증 요청의 채널명에서 노트 id를 복원한다. 우리 규칙 밖이면 null. */
export function noteIdFromPusherChannel(pusherChannel: string): string | null {
  if (!pusherChannel.startsWith(NOTE_DOC_CHANNEL_PREFIX)) {
    return null;
  }
  return pusherChannel.slice(NOTE_DOC_CHANNEL_PREFIX.length) || null;
}

/**
 * Pusher 이벤트에 실을 수 있는 base64 업데이트의 상한. Pusher의 메시지 상한이 10KB라
 * 여유를 두고 잡는다 — 넘으면 재동기화 신호로 대체한다.
 */
export const MAX_BROADCAST_UPDATE_BYTES = 8 * 1024;

/** 한 요청이 실어 올 수 있는 업데이트 상한 — 브로드캐스트 상한과 별개로 저장도 묶는다. */
export const MAX_DOC_UPDATE_BYTES = 512 * 1024;
