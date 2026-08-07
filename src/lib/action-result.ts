import { z } from '@/lib/zod';

// Server Action의 표준 반환 계약 — 실패는 사용자에게 그대로 보여줄 한 줄 문구만 담는다.
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export const GENERIC_ACTION_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// safeParse 결과를 ActionResult로 변환한다. 실패 시 첫 이슈의 메시지만 노출 —
// 사용자 에러 문구는 필드별 나열이 아니라 한 줄 안내가 규약이다.
export function parseOrError<Output>(
  schema: z.ZodType<Output>,
  input: unknown,
): ActionResult<Output> {
  // safeParse는 ZodError만 결과로 돌려준다 — 그 밖의 throw(스키마의 transform이 던지거나,
  // 입력 객체의 접근자가 던지는 경우)는 그대로 빠져나간다. 이 호출은 `guarded` **밖**에
  // 있으므로(액션들이 검증을 먼저 하고 그 뒤 트랜잭션을 guarded로 감싼다) 여기서 새면
  // 사용자는 digest만 담긴 불투명한 500을 받는다. 검증 단계가 500을 내는 건 계약 위반이라
  // 여기서 닫는다 — 개별 transform의 전역성에 기대지 않는다 (KAN-72 자체 리뷰).
  let parsed: z.ZodSafeParseResult<Output>;
  try {
    parsed = schema.safeParse(input);
  } catch (error) {
    console.error('[action] schema.safeParse threw:', error);
    return { ok: false, error: GENERIC_ACTION_ERROR };
  }
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  return { ok: true, data: parsed.data };
}

// DB 장애 등 예상 못 한 예외가 액션 밖으로 던져지면 클라이언트는 digest만 담긴
// 불투명한 에러를 받는다 — ActionResult 계약은 이 래퍼가 강제한다.
export async function guarded<T>(
  label: string,
  fn: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[action] ${label} failed:`, error);
    return { ok: false, error: GENERIC_ACTION_ERROR };
  }
}
