import { REACTION_EMOJIS } from '@/features/chat/reactions';
import type {
  ChatMessageView,
  ChatViewer,
  ReactionDelta,
  ReactionView,
} from '@/features/chat/types';

// 채널 본문과 스레드 패널이 공유하는 라이브 목록 조작. 순수 함수라 server-only가 아니다.

/** pending은 아직 서버 확정 전인 낙관 말풍선 표시다. */
export type RoomMessage = ChatMessageView & { pending?: boolean };

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

/** 델타를 목록에 적용한다. 그 메시지가 목록에 없으면 아무 일도 하지 않는다. */
export function applyReaction(
  list: RoomMessage[],
  delta: ReactionDelta,
  viewerId: string,
): RoomMessage[] {
  return list.map((message) =>
    message.id === delta.messageId
      ? { ...message, reactions: reduceReactions(message.reactions, delta, viewerId) }
      : message,
  );
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

/** 이 메시지에 내가 그 이모지를 눌러 뒀는지 — 다음 클릭의 방향을 정한다. */
export function hasMyReaction(message: RoomMessage, emoji: string): boolean {
  return message.reactions.some((reaction) => reaction.emoji === emoji && reaction.mine);
}
