import 'dotenv/config';

/**
 * 테스트가 쓸 DATABASE_URL. 개발 DB를 절대 건드리지 않는 것이 이 함수의 존재 이유다.
 *
 * - `TEST_DATABASE_URL`이 있으면 그대로 쓴다 (CI에서 전용 DB를 주입하는 경로).
 * - 없으면 `DATABASE_URL`의 **DB명에 `_test`를 붙여** 파생한다. 없는 DB는
 *   `prisma migrate deploy`가 자동으로 만들어 주므로 사전 준비가 필요 없다.
 *
 * 테스트는 매번 전 테이블을 TRUNCATE하므로, 파생 결과가 개발 DB와 같으면 즉시 중단한다.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;

  if (!base) {
    throw new Error('DATABASE_URL이 없습니다 (.env 확인). 테스트 DB는 여기서 파생됩니다.');
  }

  const url = explicit ?? deriveTestUrl(base);
  if (url === base) {
    throw new Error(
      `테스트 DB가 개발 DB와 같습니다(${url}). 테스트는 전 테이블을 지우므로 중단합니다.`,
    );
  }
  return url;
}

function deriveTestUrl(base: string): string {
  const url = new URL(base);
  // pathname은 '/dankangnote' 형태 — 선행 슬래시를 뗀 것이 DB명이다.
  const name = url.pathname.replace(/^\//, '');
  if (!name) {
    throw new Error(`DATABASE_URL에서 DB명을 찾지 못했습니다: ${base}`);
  }
  url.pathname = `/${name}_test`;
  return url.toString();
}
