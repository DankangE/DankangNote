// 노트는 항상 작성자(미상이면 null)와 함께 다닌다 — 서비스 계층의 조회 타입을 그대로 쓴다.
export type { NoteWithAuthor as Note, NoteAuthor } from '@/server/services/notes';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
