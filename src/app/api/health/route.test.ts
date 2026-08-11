import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/server/db';

import { GET } from './route';

describe('/api/health (KAN-77)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('실 DB에 붙어 적용된 마이그레이션 수를 돌려준다', async () => {
    // 라우트가 쓰는 것은 tsc가 못 읽는 생 SQL이다 — 테이블명·컬럼명을 하나 틀리면
    // **배포 확인용 엔드포인트가 정작 배포에서 처음 죽는다**. 실 DB로 밟아 두는 이유.
    // 기대값을 상수로 박지 않고 마이그레이션 디렉터리 수에서 세는 것은, 마이그레이션이
    // 늘 때마다 이 테스트를 고치게 만들면 그 순간부터 아무도 안 믿기 때문이다.
    const applied = readdirSync('prisma/migrations', { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    ).length;

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', migrations: applied });
  });

  it('DB가 죽으면 503이고 원인은 본문에 싣지 않는다', async () => {
    // 인증 없는 공개 엔드포인트라 응답 본문이 곧 공개 정보다. Prisma·pg의 연결 예외에는
    // 연결 문자열이 자격증명째로 실려 오므로, 그걸 그대로 돌려주면 DB 비밀번호가 샌다.
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(
      new Error('connect ECONNREFUSED postgresql://dankang:s3cret@db.example.com/app'),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: 'error' });
    expect(JSON.stringify(body)).not.toContain('s3cret');
  });
});
