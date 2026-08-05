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
 * resource 키는 **유계 집합에서만** 조립한다 — 정적 문자열('typing')이나 사용자당
 * 소수로 한정되는 값이 기본이고, 그런 키는 접근 판정보다 먼저 불러도 안전하다. 요청이
 * 실어 온 문자열을 그대로 키에 쓰면 스프레이가 첫 요청마다 INSERT를 통과해 행을 무한히
 * 만든다 — 리미터 자신이 쓰기 증폭기가 되는 자충수다. 엔티티 단위 키가 꼭 필요하면
 * 실존 검증 **뒤**에서만 조립하고, 행 수가 그 엔티티 수만큼 자라는 것을 안고 시작한다.
 *
 * 간격은 행이 아니라 호출에 실려 있다 — 같은 resource 키를 쓰는 호출부들은 간격도
 * 공유해야 한다. 서로 다른 minIntervalMs로 부르면 같은 lastAt을 서로 다른 자로 잰다.
 *
 * 이 문장은 호출부의 트랜잭션과 무관하게 항상 **별도 커넥션의 단문 자동커밋**으로
 * 나간다(전역 prisma를 클로저로 잡고 있어 tx 클라이언트를 받을 방법이 없다). 그래서
 * $transaction 안에서 불러도 now()·잠금의 의미는 안 바뀌지만, 바깥 트랜잭션이 롤백돼도
 * 소모한 슬롯은 돌아오지 않고, 트랜잭션이 커넥션을 쥔 채 풀의 빈자리를 또 기다리므로
 * 동시 요청이 풀(기본 10)을 고갈시킬 수 있다. 다음 사용처(메시지 전송·리액션 토글,
 * KAN-48)는 리밋을 트랜잭션 **밖에서 먼저** 묻고 시작할 것.
 */
export async function allowOnceEvery(
  minIntervalMs: number,
  userId: string,
  resource: string,
): Promise<boolean> {
  // 0·음수면 WHERE가 항상 참이 되어 리밋이 무음 해제되고, NaN은 DB까지 가서야 죽는다.
  // 간격 파생식이 잘못 바뀌었을 때 테스트 초록인 채 조용히 꺼지는 것보다 즉시 죽는 쪽이 낫다.
  if (!(minIntervalMs > 0)) {
    throw new Error(`allowOnceEvery: minIntervalMs는 양수여야 한다 (받은 값: ${minIntervalMs})`);
  }
  const rows = await prisma.$queryRaw<{ ok: number }[]>(Prisma.sql`
    INSERT INTO "RateLimit" ("userId", "resource", "lastAt")
    VALUES (${userId}, ${resource}, now())
    ON CONFLICT ("userId", "resource") DO UPDATE SET "lastAt" = now()
    WHERE "RateLimit"."lastAt" <= now() - (${minIntervalMs} * interval '1 millisecond')
    RETURNING 1 AS ok
  `);
  return rows.length > 0;
}
