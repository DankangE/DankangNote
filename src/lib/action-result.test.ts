import { describe, expect, it } from 'vitest';
import { z } from '@/lib/zod';
import { GENERIC_ACTION_ERROR, parseOrError } from './action-result';

// safeParse는 ZodError만 결과로 돌려준다 — transform이 던지거나 입력의 접근자가 던지면
// 그대로 빠져나간다. 이 호출은 액션에서 `guarded` 밖에 있어(검증 먼저, 트랜잭션은 그 뒤)
// 새는 순간 사용자가 digest만 담긴 불투명한 500을 받는다 (KAN-72 자체 리뷰 ④).
describe('parseOrError는 검증 단계에서 절대 던지지 않는다', () => {
  it('스키마 transform이 던져도 판별 결과로 돌려준다', () => {
    const schema = z.unknown().transform(() => {
      throw new Error('transform boom');
    });
    expect(() => parseOrError(schema, {})).not.toThrow();
    expect(parseOrError(schema, {})).toEqual({ ok: false, error: GENERIC_ACTION_ERROR });
  });

  it('입력 객체의 접근자가 던져도 판별 결과로 돌려준다', () => {
    const schema = z.object({ a: z.string() });
    const input = {};
    Object.defineProperty(input, 'a', {
      enumerable: true,
      get() {
        throw new Error('getter boom');
      },
    });
    expect(() => parseOrError(schema, input)).not.toThrow();
    expect(parseOrError(schema, input).ok).toBe(false);
  });

  it('정상 입력은 그대로 통과한다 (가드가 성공 경로를 바꾸지 않는다)', () => {
    expect(parseOrError(z.object({ a: z.string() }), { a: 'x' })).toEqual({
      ok: true,
      data: { a: 'x' },
    });
  });

  it('검증 실패는 여전히 첫 이슈 메시지를 그대로 준다', () => {
    const result = parseOrError(z.object({ a: z.string('문자열이 필요합니다.') }), { a: 1 });
    expect(result).toEqual({ ok: false, error: '문자열이 필요합니다.' });
  });
});
