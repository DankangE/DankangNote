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

  // 두 단계는 서로의 실패에 묶이지 않는다 (KAN-74). 스윕이 던지면 그대로 500이 되어
  // **뒤따르는 processStorageCleanup이 아예 호출되지 않았다** — 스윕이 규모 때문에 매번
  // 실패하는 상태에 빠지면 조직 삭제 프리픽스까지 outbox에 쌓인 채 영구 정체된다.
  // 하나가 죽어도 다른 하나는 돌리고, 실패는 응답에 실어 스케줄러가 알아채게 한다.
  const sweep = await attempt(() => sweepAbandonedPending());
  const outbox = await attempt(() => processStorageCleanup());

  const errors = [sweep, outbox].flatMap((r) => (r.ok ? [] : [r.error]));
  return Response.json(
    {
      swept: sweep.ok ? sweep.value : null,
      processed: outbox.ok ? outbox.value.processed : null,
      failed: outbox.ok ? outbox.value.failed : null,
      errors,
    },
    // 단계가 통째로 죽은 것만 500이다 — 삼키면 cron 대시보드가 초록으로 남아 정체를
    // 아무도 모른다. 반면 `failed`(개별 outbox 태스크 실패)는 500이 아니다: 그건 행이 남아
    // 다음 회차가 다시 시도하는 **정상 재시도 경로**라, 여기서 빨갛게 만들면 스토리지가
    // 잠깐 흔들릴 때마다 cron이 실패로 뜬다. 그 신호는 attempts·lastError가 들고 있다.
    { status: errors.length > 0 ? 500 : 200 },
  );
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    // 응답 본문은 호출한 스케줄러만 본다 — 사후 진단은 로그에 남아야 한다.
    console.error('[storage-cleanup cron]', error);
    return { ok: false, error: String(error).slice(0, 500) };
  }
}

/** 시크릿 비교는 상수 시간으로 — timingSafeEqual은 길이가 다르면 throw라 먼저 거른다. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
