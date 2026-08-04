import type { MentionSpan } from '@/features/chat/mentions';
import { REACTION_EMOJIS } from '@/features/chat/reactions';
import type {
  AttachmentView,
  ChatMessageView,
  ChatViewer,
  ReactionDelta,
  ReactionView,
} from '@/features/chat/types';

// 채널 본문과 스레드 패널이 공유하는 라이브 목록 조작. 순수 함수라 server-only가 아니다.

/**
 * pending은 아직 서버 확정 전인 낙관 말풍선 표시다.
 *
 * reactionVersions는 (이모지 → 마지막에 적용한 집계 버전) (KAN-52). 없는 이모지는
 * reactionVersion(스냅샷 기준선)으로 떨어진다. **칩이 사라져도 여기 번호는 남는다** —
 * 마지막 한 명이 취소해 칩이 없어진 뒤 그보다 옛 델타가 도착하면, 기억이 없으면 그 칩이
 * 되살아난다. 서버 상태에 없는 리액션이 화면에만 남는 것이 이 티켓의 증상 그대로다.
 */
export type RoomMessage = ChatMessageView & {
  pending?: boolean;
  reactionVersions?: Record<string, number>;
};

/**
 * 이미 있는 id(자기 전송의 브로드캐스트 echo)는 버리고,
 * replaceId가 있으면 낙관 임시 항목을 서버 확정본으로 교체한다.
 */
export function upsert(
  list: RoomMessage[],
  incoming: RoomMessage,
  replaceId?: string,
): RoomMessage[] {
  const rest = replaceId ? list.filter((message) => message.id !== replaceId) : list;
  if (rest.some((message) => message.id === incoming.id)) {
    return rest;
  }
  return [...rest, incoming];
}

// 같은 작성자의 연속 메시지를 한 묶음으로 접는(슬랙식) 시간 창.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * 직전 행과 묶어 보여줄지 — 같은 작성자이고 5분 안이면 아바타·이름을 접는다.
 * 스레드는 며칠에 걸쳐 이어지는 일이 흔해 시간 창이 본문보다 더 필요하다.
 */
export function isGrouped(previous: RoomMessage | undefined, current: RoomMessage): boolean {
  if (!previous || previous.authorId !== current.authorId) {
    return false;
  }
  return (
    new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() <
    GROUP_WINDOW_MS
  );
}

/**
 * 전송 즉시 붙일 낙관 말풍선. 서버가 확정본을 돌려주면 tempId로 교체된다.
 * 연속 전송이 서로 간섭하지 않도록 매번 새 tempId를 쓴다.
 */
export function pendingMessage(
  viewer: ChatViewer,
  channelId: string,
  body: string,
  parentId: string | null,
  mentions: MentionSpan[] = [],
  attachments: AttachmentView[] = [],
): RoomMessage {
  return {
    id: `pending-${crypto.randomUUID()}`,
    channelId,
    parentId,
    authorId: viewer.id,
    authorName: viewer.name,
    authorImageUrl: viewer.imageUrl,
    body,
    createdAt: new Date().toISOString(),
    // 답글은 스레드 1단계라 자기 답글을 가질 수 없다.
    replyCount: 0,
    // 아직 서버에 없는 메시지라 누를 수 있는 리액션도 없다.
    reactions: [],
    // 서버가 준 적 없는 메시지라 기준선도 없다 — 확정본으로 교체될 때 진짜 값이 온다.
    reactionVersion: 0,
    // 멘션은 컴포저가 방금 고른 것을 그대로 쓴다 — 낙관 말풍선에서도 강조가 바로 보인다.
    // 서버가 확정본을 돌려주면 검증을 통과한 것만 남은 목록으로 교체된다.
    mentions,
    // 첨부는 전송 전에 이미 업로드가 끝나 실제 id를 갖고 있다(KAN-35) — 낙관 말풍선의
    // 이미지도 진짜 주소로 그려진다(pending 첨부는 업로더 본인에게만 서빙된다).
    attachments,
    pending: true,
  };
}

// 칩 표시 순서는 서버(loadReactions)와 같은 팔레트 순서다 — 실시간으로 새 이모지가 붙을 때
// 끝에 쌓이면, 새로고침 한 번에 순서가 바뀌어 방금 누른 칩이 다른 자리로 튄다.
const EMOJI_ORDER = new Map<string, number>(REACTION_EMOJIS.map((emoji, i) => [emoji, i]));

function sortedByPalette(reactions: ReactionView[]): ReactionView[] {
  return reactions.sort((a, b) => (EMOJI_ORDER.get(a.emoji) ?? 99) - (EMOJI_ORDER.get(b.emoji) ?? 99));
}

/**
 * 한 메시지의 리액션 목록에 서버 델타를 반영한다 (KAN-31).
 *
 * count는 절대값이라 그대로 덮는다 — 그래서 같은 델타가 두 번 와도, 순서가 뒤바뀌어 와도
 * 마지막에 도착한 서버 상태로 수렴한다. mine은 나에 대한 것이라 내가 누른 델타에서만 바꾸고,
 * 남이 누른 델타에서는 내가 이미 눌러 둔 상태를 그대로 보존한다.
 */
function reduceReactions(
  reactions: ReactionView[],
  delta: ReactionDelta,
  viewerId: string,
): ReactionView[] {
  const rest = reactions.filter((reaction) => reaction.emoji !== delta.emoji);
  // 마지막 한 명이 취소하면 칩 자체를 없앤다(count 0짜리 빈 칩이 남지 않게).
  if (delta.count === 0) {
    return rest;
  }
  const current = reactions.find((reaction) => reaction.emoji === delta.emoji);
  return sortedByPalette([
    ...rest,
    {
      emoji: delta.emoji,
      count: delta.count,
      mine: delta.userId === viewerId ? delta.added : (current?.mine ?? false),
    },
  ]);
}

/**
 * 이 칩에 반영된 마지막 집계 버전 (KAN-52). 그 이모지로 델타를 받은 적이 없으면
 * 조회 스냅샷의 기준선이다.
 */
export function appliedVersion(message: RoomMessage, emoji: string): number {
  return message.reactionVersions?.[emoji] ?? message.reactionVersion;
}

/**
 * 내가 토글을 시작한 뒤로 서버 값이 이 칩을 덮었는가.
 *
 * 실패한 토글을 되돌릴 때 count까지 ∓1 할지, 내 표시만 되돌릴지를 가른다(markMyReaction
 * 주석 참조). '서버 델타가 도착했는가'가 아니라 **적용됐는가**를 묻는 것이 중요하다 —
 * 역순 배달로 버려진 델타는 화면을 바꾸지 않았으므로 내 낙관 ∓1이 아직 그대로 있고,
 * 그때 표시만 되돌리면 count가 1만큼 어긋난 채 남는다.
 */
export function serverOverwrote(
  list: RoomMessage[],
  messageId: string,
  emoji: string,
  since: number,
): boolean {
  const message = list.find((entry) => entry.id === messageId);
  return message ? appliedVersion(message, emoji) > since : false;
}

/**
 * 델타를 목록에 적용한다. 그 메시지가 목록에 없으면 아무 일도 하지 않는다.
 *
 * **이미 적용한 것보다 낮은 버전은 버린다 (KAN-52).** count가 절대값이라 중복 배달은
 * 무해하지만 역순 배달은 아니다 — A가 커밋해 count=1을 읽고 브로드캐스트 직전에 지연되는
 * 사이 B가 커밋해 count=2를 먼저 쏘면, 수신 측은 2 다음 1을 적용해 DB가 2인데 화면은 1로
 * 굳는다. 본문 목록에는 재동기 경로가 없어 다음 리액션이나 새로고침 전까지 그대로다.
 *
 * 판정을 여기 두는 것이 핵심이다. 이 함수가 본문 목록과 스레드 패널이 함께 쓰는 유일한
 * 적용 지점이라, 두 화면이 각자 자기가 들고 있는 것 기준으로 같은 규칙을 얻는다.
 * 훅에 ref로 두면 패널이 자기 응답을 직접 반영하는 경로가 그 판정을 비켜 간다.
 */
export function applyReaction(
  list: RoomMessage[],
  delta: ReactionDelta,
  viewerId: string,
): RoomMessage[] {
  return list.map((message) => {
    if (message.id !== delta.messageId) {
      return message;
    }
    if (delta.version <= appliedVersion(message, delta.emoji)) {
      return message;
    }
    return {
      ...message,
      reactionVersions: { ...message.reactionVersions, [delta.emoji]: delta.version },
      reactions: reduceReactions(message.reactions, delta, viewerId),
    };
  });
}

/**
 * 서버 응답을 기다리지 않고 내 리액션만 먼저 뒤집는다.
 *
 * next를 인자로 받아 '토글'이 아니라 '이 상태로 맞춰라'로 만든 것이 핵심이다. 실패 시
 * 되돌리기가 같은 함수의 반대 인자 한 번이고, 이미 그 상태면 count를 건드리지 않아
 * 두 번 적용해도 어긋나지 않는다. 남이 누른 몫(count의 나머지)은 손대지 않는다 —
 * 전체 스냅샷 복원이 아니라 내가 바꾼 것만 되돌리는 타깃 롤백이다.
 */
export function setMyReaction(
  list: RoomMessage[],
  messageId: string,
  emoji: string,
  viewerId: string,
  next: boolean,
): RoomMessage[] {
  return list.map((message) => {
    if (message.id !== messageId) {
      return message;
    }
    const current = message.reactions.find((reaction) => reaction.emoji === emoji);
    if ((current?.mine ?? false) === next) {
      return message;
    }
    const rest = message.reactions.filter((reaction) => reaction.emoji !== emoji);
    const count = (current?.count ?? 0) + (next ? 1 : -1);
    return {
      ...message,
      reactions: count > 0 ? sortedByPalette([...rest, { emoji, count, mine: next }]) : rest,
    };
  });
}

/**
 * count는 그대로 두고 내 표시만 되돌린다.
 *
 * 낙관 적용과 롤백 사이에 서버 절대값이 도착했을 때 쓴다. 그 값은 실패한 내 토글을
 * 포함하지 않은 진짜 카운트라, 여기서 setMyReaction으로 또 ∓1 하면 그만큼 어긋난 채
 * 굳는다(다음 델타가 올 때까지). 되돌릴 것은 이미 덮인 count가 아니라 내 표시뿐이다.
 */
export function markMyReaction(
  list: RoomMessage[],
  messageId: string,
  emoji: string,
  mine: boolean,
): RoomMessage[] {
  return list.map((message) =>
    message.id === messageId
      ? {
          ...message,
          reactions: message.reactions.map((reaction) =>
            reaction.emoji === emoji ? { ...reaction, mine } : reaction,
          ),
        }
      : message,
  );
}

/** 이 메시지에 내가 그 이모지를 눌러 뒀는지 — 다음 클릭의 방향을 정한다. */
export function hasMyReaction(message: RoomMessage, emoji: string): boolean {
  return message.reactions.some((reaction) => reaction.emoji === emoji && reaction.mine);
}

/** 델타·in-flight 추적의 키. 리액션은 (메시지, 이모지)마다 독립이다. */
export function reactionKey(messageId: string, emoji: string): string {
  return `${messageId}:${emoji}`;
}
