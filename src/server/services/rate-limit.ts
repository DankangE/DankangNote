import 'server-only';

import { prisma } from '@/server/db';
import { Prisma } from '@/server/generated/prisma/client';

/**
 * (userId, resource)에 최소 간격을 강제한다 (KAN-57). true면 이번 요청이 허용된 것이고,
 * 그 사실 자체가 기록이다 — 다음 허용은 지금부터 minIntervalMs 뒤다.
 *
 * 판정과 기록이 한 문장이다(INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING).
 * 경합하는 두 요청 중 늦은 쪽은 앞선 쪽의 행 잠금에 걸렸다가 **갱신된** lastAt으로
 * WHERE를 다시 평가하므로, 같은 간격 안에서는 몇 개가 동시에 와도 정확히 하나만
 * 허용된다. 읽고-비교하고-쓰는 두 문장으로 쪼개면 그 사이가 곧 경합 창이다.
 *
 * 시계는 전부 DB의 now()다 — 앱 인스턴스의 벽시계로 비교하면 인스턴스 간 NTP 스큐가
 * 그대로 간격 오차가 된다(메시지 순서를 앱 시계에서 뗀 것과 같은 이유, 규약 20).
 * 인메모리가 아니라 DB인 이유도 같은 곳에 있다: 서버리스 인스턴스마다 따로 세는
 * 카운터는 인스턴스 수만큼 리밋을 곱해 주는 것과 같다.
 *
 * resource는 **호출부가 실존을 검증한 id로만** 조립한다. 검증 전 입력을 그대로 키로
 * 쓰면 임의 문자열 스프레이가 첫 요청마다 INSERT를 통과해 이 테이블에 무한히 행을
 * 만든다 — 리미터 자신이 쓰기 증폭기가 되는 자충수다. (타이핑 라우트가 접근 판정
 * 뒤에서 부르는 이유.)
 */
export async function allowOnceEvery(
  minIntervalMs: number,
  userId: string,
  resource: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ ok: number }[]>(Prisma.sql`
    INSERT INTO "RateLimit" ("userId", "resource", "lastAt")
    VALUES (${userId}, ${resource}, now())
    ON CONFLICT ("userId", "resource") DO UPDATE SET "lastAt" = now()
    WHERE "RateLimit"."lastAt" <= now() - (${minIntervalMs} * interval '1 millisecond')
    RETURNING 1 AS ok
  `);
  return rows.length > 0;
}
