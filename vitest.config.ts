import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));
const serverOnlyStub = fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 마이그레이션 적용(1회) → 각 워커에서 DATABASE_URL을 테스트 DB로 교체.
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // 전 테스트가 한 DB를 공유하고 각 테스트가 TRUNCATE로 시작한다 — 병렬로 돌면
    // 서로의 데이터를 지운다. 순차 실행이 이 하네스의 전제다.
    fileParallelism: false,
    // 마이그레이션 + 첫 DB 커넥션이 기본 5초를 넘길 수 있다.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': src,
      // Next 밖에서는 실제 server-only가 throw하므로 빈 모듈로 대체한다.
      'server-only': serverOnlyStub,
    },
  },
});
