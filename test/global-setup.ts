import { execFileSync } from 'node:child_process';
import { testDatabaseUrl } from './database-url';

// 테스트 시작 전 한 번: 테스트 DB에 마이그레이션을 적용한다.
// migrate deploy는 대상 DB가 없으면 만들어 주므로 별도 생성 절차가 필요 없다.
export default function setup() {
  const url = testDatabaseUrl();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
