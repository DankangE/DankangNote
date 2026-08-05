import { timingSafeEqual } from 'node:crypto';
import {
  processStorageCleanup,
  sweepAbandonedPending,
} from '@/server/services/storage-cleanup';

/**
 * 스토리지 정리 스윕 (KAN-70) — 버려진 pending 걷기 + outbox 처리. Vercel Cron이 부르는
 * 자리다(GET + `Authorization: Bearer ${CRON_SECRET}` 관례). cron 등록 자체는 배포가 생기는
 * KAN-27에서 하고, 그 전에는 같은 헤더로 수동 호출해 돌린다(docs/deploy-staging.md).
 *
 * 세션 인증이 아니라 공유 시크릿인 이유: 호출 주체가 사람이 아니라 스케줄러다. 시크릿이
 * 없으면 전부 거부한다(fail-closed) — 정리 자체는 지울 것만 지워 파괴적이지 않지만,
 * 익명이 스토리지 list/delete 부하를 유발할 자리를 열어 둘 이유가 없다.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get('authorization');
  if (!secret || !header || !constantTimeEquals(header, `Bearer ${secret}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const swept = await sweepAbandonedPending();
  const { processed, failed } = await processStorageCleanup();
  return Response.json({ swept, processed, failed });
}

/** 시크릿 비교는 상수 시간으로 — timingSafeEqual은 길이가 다르면 throw라 먼저 거른다. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
