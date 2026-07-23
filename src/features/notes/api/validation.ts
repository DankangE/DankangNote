import { z } from '@/lib/zod';
import type { ActionResult } from '@/features/notes/types';

// 액션('use server')과 조회(server-only)가 공유하는 스키마 — 'use server' 모듈은
// async 함수만 export할 수 있어 스키마를 별도 모듈로 둔다.

export const noteInputSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력하세요.').max(200, '제목은 200자 이하여야 합니다.'),
  content: z.string().max(50_000, '본문이 너무 깁니다.').optional(),
});

export const noteIdSchema = z.string().min(1, '노트 id가 필요합니다.');

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
