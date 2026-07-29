// 서버 조회·Pusher 이벤트·클라이언트 상태가 공유하는 메시지 뷰 모델.
// createdAt은 ISO 문자열 — Pusher 페이로드(JSON)와 RSC prop의 형태를 통일한다.
// channelId는 브로드캐스트 수신 측이 '지금 보고 있는 채널의 메시지인지' 판별하는 데 쓴다
// (채널마다 Pusher 채널이 갈리지만, 잔여 구독이 섞이는 경계 상황의 마지막 방어선이다).
export type ChatMessageView = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorImageUrl: string | null;
  body: string;
  createdAt: string;
};

// 현재 사용자의 표시 정보 — 낙관 전송 말풍선에 쓴다. 미러 테이블이 아직 동기화
// 전일 수 있어 서버에서 Clerk 세션 기준으로 채워 내려보낸다.
export type ChatViewer = {
  id: string;
  name: string;
  imageUrl: string | null;
};

// 채널 뷰 타입은 서비스 계층의 것을 그대로 쓴다(보드와 같은 방식).
export type { ChannelView } from '@/server/services/channels';
export type { ChannelPersonView } from '@/server/services/channel-members';
