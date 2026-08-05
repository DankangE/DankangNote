import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { resetDatabase } from '../../../test/db';
import { allowOnceEvery } from './rate-limit';

// 테넌트 시드가 없는 것은 의도다 — RateLimit은 FK 없는 사용자 단위 운영 상태라
// 미러(User/Organization)가 아직 없는 시점에도 동작해야 한다(스키마 주석 참조).
beforeEach(async () => {
  await resetDatabase();
});

const INTERVAL_MS = 60_000;
const USER = 'user_limited';
const RESOURCE = 'typing:chan_x';

/** 행의 lastAt을 과거로 밀어 '간격이 지났다'를 잠들지 않고 만든다. */
async function ageLastAllowed(userId: string, resource: string, byMs: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "RateLimit" SET "lastAt" = "lastAt" - (${byMs} * interval '1 millisecond')
    WHERE "userId" = ${userId} AND "resource" = ${resource}
  `;
}

describe('allowOnceEvery (KAN-57)', () => {
  it('첫 요청은 허용된다', async () => {
    expect(await allowOnceEvery(INTERVAL_MS, USER, RESOURCE)).toBe(true);
  });

  it('간격 안의 재요청은 거부되고, 거부는 기록을 되밀지 않는다', async () => {
    await allowOnceEvery(INTERVAL_MS, USER, RESOURCE);
    const before = await prisma.rateLimit.findUniqueOrThrow({
      where: { userId_resource: { userId: USER, resource: RESOURCE } },
    });

    expect(await allowOnceEvery(INTERVAL_MS, USER, RESOURCE)).toBe(false);

    // 거부가 lastAt을 갱신하면 안 된다 — 갱신하면 간격 안에서 계속 두드리는 쪽의
    // 기준선이 계속 앞으로 밀려, 정상 간격으로 돌아온 뒤에도 영영 허용되지 않는다.
    const after = await prisma.rateLimit.findUniqueOrThrow({
      where: { userId_resource: { userId: USER, resource: RESOURCE } },
    });
    expect(after.lastAt.getTime()).toBe(before.lastAt.getTime());
  });

  it('간격이 지나면 다시 허용된다', async () => {
    await allowOnceEvery(INTERVAL_MS, USER, RESOURCE);
    await ageLastAllowed(USER, RESOURCE, INTERVAL_MS);

    expect(await allowOnceEvery(INTERVAL_MS, USER, RESOURCE)).toBe(true);
  });

  it('간격의 절반만 지났으면 여전히 거부된다', async () => {
    // 간격의 '단위'를 고정한다 — 이 테스트가 없으면 쿼리의 interval 단위가 어긋나
    // 문턱이 1000배 짧아져도(millisecond→microsecond) 나머지 테스트는 전부 초록이다.
    await allowOnceEvery(INTERVAL_MS, USER, RESOURCE);
    await ageLastAllowed(USER, RESOURCE, INTERVAL_MS / 2);

    expect(await allowOnceEvery(INTERVAL_MS, USER, RESOURCE)).toBe(false);
  });

  it('양수가 아닌 간격은 throw한다 — 리밋이 조용히 꺼진 채 지나가지 않게', async () => {
    await expect(allowOnceEvery(0, USER, RESOURCE)).rejects.toThrow();
    await expect(allowOnceEvery(-1, USER, RESOURCE)).rejects.toThrow();
    await expect(allowOnceEvery(Number.NaN, USER, RESOURCE)).rejects.toThrow();
  });

  it('리소스가 다르면 서로 세지 않는다', async () => {
    await allowOnceEvery(INTERVAL_MS, USER, 'typing:chan_x');

    expect(await allowOnceEvery(INTERVAL_MS, USER, 'typing:chan_y')).toBe(true);
  });

  it('사람이 다르면 서로 세지 않는다', async () => {
    await allowOnceEvery(INTERVAL_MS, USER, RESOURCE);

    expect(await allowOnceEvery(INTERVAL_MS, 'user_someone_else', RESOURCE)).toBe(true);
  });

  it('동시 요청은 정확히 하나만 허용된다', async () => {
    // 판정·기록이 한 문장인 것의 존재 이유다 — 읽고-쓰는 두 문장이었다면 이 다섯이
    // 전부 '아직 행이 없다'를 읽고 전부 허용됐을 것이다.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => allowOnceEvery(INTERVAL_MS, USER, RESOURCE)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
