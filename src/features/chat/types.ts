// 서버 조회·Pusher 이벤트·클라이언트 상태가 공유하는 메시지 뷰 모델.
// createdAt은 ISO 문자열 — Pusher 페이로드(JSON)와 RSC prop의 형태를 통일한다.
export type ChatMessageView = {
  id: string;
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
