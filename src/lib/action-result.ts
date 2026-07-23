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
  const parsed = schema.safeParse(input);
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
