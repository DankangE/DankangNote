import type { ChatMessageView, ChatViewer } from '@/features/chat/types';

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
    pending: true,
  };
}
