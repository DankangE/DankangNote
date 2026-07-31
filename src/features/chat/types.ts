// 서버 조회·Pusher 이벤트·클라이언트 상태가 공유하는 메시지 뷰 모델.
// createdAt은 ISO 문자열 — Pusher 페이로드(JSON)와 RSC prop의 형태를 통일한다.
// channelId는 브로드캐스트 수신 측이 '지금 보고 있는 채널의 메시지인지' 판별하는 데 쓴다
// (채널마다 Pusher 채널이 갈리지만, 잔여 구독이 섞이는 경계 상황의 마지막 방어선이다).
export type ChatMessageView = {
  id: string;
  channelId: string;
  /** 스레드 루트 메시지 id. null이면 채널 본문에 보이는 루트다(KAN-30). */
  parentId: string | null;
  authorId: string;
  authorName: string;
  authorImageUrl: string | null;
  body: string;
  createdAt: string;
  /** 이 메시지에 달린 답글 수. 답글 자신은 늘 0이다(스레드는 1단계). */
  replyCount: number;
  /** 이 메시지에 눌린 리액션. 아무도 안 눌렀으면 빈 배열이다(KAN-31). */
  reactions: ReactionView[];
};

/** 이모지 하나에 대한 집계. mine은 보는 사람마다 다르므로 조회 시점에 서버가 채운다. */
export type ReactionView = {
  emoji: string;
  count: number;
  /** 내가 눌렀는지 — 강조 표시와 다음 클릭의 방향(추가/취소)이 여기서 나온다. */
  mine: boolean;
};

/**
 * 리액션 한 번의 결과를 실시간으로 알리는 페이로드(KAN-31).
 *
 * 증감분(+1/-1)이 아니라 **토글 직후의 절대 count**를 싣는다. Pusher는 같은 이벤트를 두 번
 * 배달할 수 있고 재연결 중 이벤트를 놓칠 수도 있어, 증감분을 누적하면 카운트가 조용히
 * 어긋난 채 굳는다. 절대값이면 중복 배달이 그냥 같은 값을 한 번 더 쓰는 것이라 무해하다.
 *
 * mine은 여기 없다 — 보는 사람마다 다르다. 수신 측이 userId를 자기 것과 비교해 채운다.
 * parentId는 이 메시지가 답글인지 판별하는 데 쓴다(본문 목록 vs 스레드 패널).
 */
export type ReactionDelta = {
  messageId: string;
  channelId: string;
  parentId: string | null;
  emoji: string;
  count: number;
  /** 이번에 누른 사람. 수신 측이 자기 자신이면 mine을 added로 맞춘다. */
  userId: string;
  /** true면 추가, false면 취소. */
  added: boolean;
};

// 현재 사용자의 표시 정보 — 낙관 전송 말풍선에 쓴다. 미러 테이블이 아직 동기화
// 전일 수 있어 서버에서 Clerk 세션 기준으로 채워 내려보낸다.
export type ChatViewer = {
  id: string;
  name: string;
  imageUrl: string | null;
};

// 채널·페이지 뷰 타입은 서비스 계층의 것을 그대로 쓴다(보드와 같은 방식).
export type { ChannelView } from '@/server/services/channels';
export type { ChannelPersonView } from '@/server/services/channel-members';
export type { MessagePage, ThreadView } from '@/server/services/chat';
