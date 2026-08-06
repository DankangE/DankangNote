// 파일 첨부의 공용 규칙 — KAN-35(채팅)에서 도입, KAN-38(노트 이미지)이 공유하게 되며
// lib로 승격(architecture.md: 두 도메인 이상이면 lib). 비밀 없는 순수 값·함수라 클라이언트
// 포함 어디서든 import된다. 규칙의 근거 주석은 features/chat/attachments.ts에 남아 있다.

/** 파일 하나의 상한 — 강제는 presign POST 정책(content-length-range)이 한다. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * `<img>`로 인라인 렌더해도 안전한 타입만. SVG는 이미지지만 여기 없다 — 마크업이라
 * 스크립트를 품을 수 있다. 목록 밖 타입은 전부 Content-Disposition: attachment.
 */
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function isInlineImage(contentType: string): boolean {
  return INLINE_IMAGE_TYPES.has(contentType);
}
