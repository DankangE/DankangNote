// 첨부 파일 규칙의 단일 정의 (KAN-35) — 서버(presign 정책·바인딩)와 클라이언트(선택 검증·
// 렌더 분기)가 공유한다. 비밀이 없는 순수 값·함수뿐이라 server-only가 아니다(reactions.ts와
// 같은 위치 선정).

/**
 * 파일 하나의 상한과 인라인 안전 타입 — KAN-38에서 노트 이미지와 공유하게 돼 lib로
 * 승격됐다(원 근거 주석은 lib/attachments.ts). 기존 호출부를 위해 재수출한다.
 * 클라이언트 검증은 편의고, 강제는 presign의 POST 정책(content-length-range)이 한다 —
 * presigned PUT은 Content-Length가 서명에 안 들어가 선언보다 큰 파일을 막을 수 없어
 * POST 방식을 쓴다(src/server/storage.ts).
 */
export { MAX_ATTACHMENT_BYTES, isInlineImage } from '@/lib/attachments';

/** 메시지 하나에 붙일 수 있는 첨부 수. 페이로드(Pusher 10KB)와 화면 양쪽의 상한이다. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

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
