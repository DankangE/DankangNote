import { beforeEach, describe, expect, it, vi } from 'vitest';

// 이 파일만 모듈을 대역으로 세운다 — 검증 대상이 '두 단계가 서로의 실패에 묶이지 않는가'라
// 실패를 실제로 만들 수단이 필요하고, 그 실패는 규모(수백만 행)에서만 나오는 것이라 DB로는
// 재현할 수 없다. 정리 로직 자체는 서비스 테스트가 실 DB로 검증한다.
const sweepAbandonedPending = vi.fn();
const processStorageCleanup = vi.fn();
vi.mock('@/server/services/storage-cleanup', () => ({
  sweepAbandonedPending: () => sweepAbandonedPending(),
  processStorageCleanup: () => processStorageCleanup(),
}));

process.env.CRON_SECRET = 'test-cron-secret';
const { GET } = await import('./route');

const call = (secret = 'test-cron-secret') =>
  GET(
    new Request('http://localhost/api/cron/storage-cleanup', {
      headers: { authorization: `Bearer ${secret}` },
    }),
  );

beforeEach(() => {
  sweepAbandonedPending.mockReset();
  processStorageCleanup.mockReset();
});

describe('storage-cleanup cron — 단계 격리 (KAN-74)', () => {
  it('스윕이 실패해도 outbox 처리는 돈다', async () => {
    // 이 격리가 없으면 스윕이 던지는 순간 라우트가 500으로 끝나 processStorageCleanup이
    // **아예 호출되지 않는다** — 조직 삭제 프리픽스까지 outbox에 쌓인 채 영구 정체된다.
    sweepAbandonedPending.mockRejectedValue(new Error('트랜잭션 타임아웃'));
    processStorageCleanup.mockResolvedValue({ processed: 7, failed: 1 });

    const response = await call();
    const body = (await response.json()) as Record<string, unknown>;

    expect(processStorageCleanup).toHaveBeenCalledTimes(1);
    expect(body.processed).toBe(7);
    expect(body.failed).toBe(1);
    expect(body.swept).toBeNull();
    expect(String(body.errors)).toContain('트랜잭션 타임아웃');
    // 실패를 200으로 삼키면 cron 대시보드가 초록으로 남아 정체를 아무도 모른다.
    expect(response.status).toBe(500);
  });

  it('outbox 처리가 실패해도 스윕 결과는 보고된다', async () => {
    sweepAbandonedPending.mockResolvedValue(3);
    processStorageCleanup.mockRejectedValue(new Error('스토리지 불통'));

    const response = await call();
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.swept).toBe(3);
    expect(body.processed).toBeNull();
    expect(response.status).toBe(500);
  });

  it('둘 다 성공하면 200과 집계를 돌려준다', async () => {
    sweepAbandonedPending.mockResolvedValue(2);
    processStorageCleanup.mockResolvedValue({ processed: 5, failed: 0 });

    const response = await call();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ swept: 2, processed: 5, failed: 0, errors: [] });
  });

  it('시크릿이 틀리면 아무것도 돌지 않는다 (fail-closed)', async () => {
    const response = await call('wrong');

    expect(response.status).toBe(401);
    expect(sweepAbandonedPending).not.toHaveBeenCalled();
    expect(processStorageCleanup).not.toHaveBeenCalled();
  });
});
