import { execFileSync } from 'node:child_process';
import { testDatabaseUrl } from './database-url';

// 테스트 시작 전 한 번: 테스트 DB에 마이그레이션을 적용한다.
// migrate deploy는 대상 DB가 없으면 만들어 주므로 별도 생성 절차가 필요 없다.
export default function setup() {
  const url = testDatabaseUrl();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    // DATABASE_URL_UNPOOLED도 반드시 함께 덮는다 (KAN-77). prisma.config.ts가 그 키를
    // **먼저** 보는데, 배포 환경을 붙여 본 개발자의 .env에는 스테이징 직결 문자열이 들어
    // 있다 — DATABASE_URL만 덮으면 `pnpm test` 한 번이 스테이징에 migrate deploy를 날린다.
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
    stdio: 'inherit',
  });
}
