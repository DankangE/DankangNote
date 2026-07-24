// 노트는 항상 작성자(미상이면 null)와 함께 다닌다 — 서비스 계층의 조회 타입을 그대로 쓴다.
export type { NoteWithAuthor as Note, NoteAuthor } from '@/server/services/notes';

export type { ActionResult } from '@/lib/action-result';

// 노트 편집·삭제 버튼 노출 판단용 뷰어(서버가 내려준다). 서버 권한 강제가 본선이고 이건 편의(KAN-18).
export interface NoteViewer {
  userId: string;
  isAdmin: boolean;
}
