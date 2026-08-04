// 첨부 파일 규칙의 단일 정의 (KAN-35) — 서버(presign 정책·바인딩)와 클라이언트(선택 검증·
// 렌더 분기)가 공유한다. 비밀이 없는 순수 값·함수뿐이라 server-only가 아니다(reactions.ts와
// 같은 위치 선정).

/**
 * 파일 하나의 상한. 클라이언트 검증은 편의고, 강제는 presign의 POST 정책
 * (content-length-range)이 한다 — presigned PUT은 Content-Length가 서명에 안 들어가
 * 선언한 크기보다 큰 파일을 막을 수 없어서 POST 방식을 쓴다(src/server/storage.ts).
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** 메시지 하나에 붙일 수 있는 첨부 수. 페이로드(Pusher 10KB)와 화면 양쪽의 상한이다. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/**
 * `<img>`로 인라인 렌더해도 안전한 타입만. **SVG는 이미지지만 여기 없다** — 마크업이라
 * 스크립트를 품을 수 있고, 링크로 새 탭에서 열리는 순간 스토리지 origin에서 실행된다.
 * 목록에 없는 타입은 전부 다운로드 칩으로만 다루고, 다운로드 presign이
 * Content-Disposition: attachment를 강제한다.
 */
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function isInlineImage(contentType: string): boolean {
  return INLINE_IMAGE_TYPES.has(contentType);
}

/** 파일 크기 표시 — 칩에 들어가는 짧은 형태('812KB', '3.4MB'). */
export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size}B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)}KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 첨부 접근은 항상 우리 라우트를 거친다 — 매 요청 접근 판정 후 짧은 presigned URL로
 * 302 한다. 스토리지 URL을 뷰 모델에 직접 실으면 만료가 화면 수명과 어긋나고(열어 둔 탭의
 * 이미지가 깨진다), 무엇보다 발급 시점 한 번의 판정에 영영 기대게 된다.
 */
export function attachmentUrl(id: string, download = false): string {
  return `/api/chat/attachments/${encodeURIComponent(id)}${download ? '?download=1' : ''}`;
}
