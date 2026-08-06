import type { NoteAuthor } from '@/features/notes/types';

// 노트 표시용 포맷 헬퍼 — 상세(NoteDetail)와 트리에서 공유한다(KAN-37에서 NoteCard로부터 추출).

// 타임존을 명시적으로 고정 — 서버/클라 동일 결과라 hydration이 안전하고,
// UTC 슬라이스와 달리 KST 사용자에게 올바른 날짜를 보여준다.
export const noteDateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// 작성자 표시명 — 이름이 없으면 이메일, 그것도 없으면(스켈레톤 유저) 표시하지 않는다.
// user_... 원시 id는 사용자에게 무의미해서 fallback으로 쓰지 않는다.
export function authorLabel(author: NoteAuthor | null): string | null {
  if (!author) return null;
  return [author.firstName, author.lastName].filter(Boolean).join(' ') || author.email || null;
}
