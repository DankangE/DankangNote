import type { MentionSpan } from '@/features/chat/mentions';

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
  /**
   * 위 reactions가 어느 집계 버전의 것인지 (KAN-52). 이 스냅샷을 받은 뒤에 도착한 델타 중
   * 이보다 낮은 번호는 이미 반영된 과거라 버린다 — 조회 중 날아오던 델타가 뒤늦게 도착해
   * 화면을 되돌리지 못하게 하는 기준선이다.
   */
  reactionVersion: number;
  /** 본문 안 멘션의 위치와 대상. 렌더러가 이 구간만 강조한다(KAN-32). */
  mentions: MentionSpan[];
  /** 이 메시지의 첨부 (KAN-35). 없으면 빈 배열. 본문이 비고 첨부만 있는 메시지도 있다. */
  attachments: AttachmentView[];
};

/**
 * 첨부 하나의 뷰 (KAN-35). URL이 없는 것은 의도다 — 접근은 항상
 * `/api/chat/attachments/[id]`를 거쳐 매 요청 판정 후 짧은 presigned URL로 302 한다.
 * 스토리지 URL을 여기 실으면 만료가 화면 수명과 어긋나고, 발급 시점 판정에 영영 기댄다.
 */
export type AttachmentView = {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
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
  /**
   * 이 메시지 집계의 단조 버전 (KAN-52). 서버가 토글마다 메시지 행 잠금 아래에서 발급하므로
   * 번호 순서가 곧 커밋 순서다 — 수신 측은 (메시지, 이모지)마다 마지막에 적용한 번호를
   * 기억해 그보다 낮은 델타를 버린다.
   *
   * 절대 count만으로는 이걸 못 푼다. 중복 배달에는 면역이지만 **역순 배달**에는 아니어서,
   * 늦게 도착한 옛 count가 최신 값을 덮고 그대로 굳는다(본문 목록에는 재동기 경로가 없다).
   */
  version: number;
  /** 이번에 누른 사람. 수신 측이 자기 자신이면 mine을 added로 맞춘다. */
  userId: string;
  /** true면 추가, false면 취소. */
  added: boolean;
};

/**
 * 클라이언트 내부용 — 도착 순번을 붙인 델타.
 *
 * ChatRoom이 모은 델타 피드를 스레드 패널이 훑어 자기 몫을 가져가는데, 피드가 바뀔 때마다
 * 통째로 다시 접으면 **이미 반영한 옛 델타가 다시 적용된다**. count가 절대값이라 그건
 * 덮어쓰기이고, 그 사이 올려 둔 낙관 값이나 더 최신 값을 과거로 되돌린다. seq가 '어디까지
 * 봤는지'의 기준이 되어 새로 온 것만 접게 한다(답글 피드는 upsert가 단조라 이게 필요 없다).
 */
export type LiveReaction = {
  seq: number;
  delta: ReactionDelta;
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
