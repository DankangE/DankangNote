import { prisma } from '@/server/db';

/**
 * 배포 확인용 헬스체크 (KAN-77). 배포 직후 알아야 하는 것은 둘이다 — **런타임이 DB에 실제로
 * 붙는가**와 **마이그레이션이 다 올라갔는가**. 빌드가 초록이어도 런타임 DATABASE_URL이 틀리면
 * 첫 사용자 요청에서야 드러나므로, 사람 대신 스모크 테스트가 먼저 밟는 자리를 만든다.
 * 커밋 SHA를 같이 싣는 것은 "지금 떠 있는 게 내가 머지한 커밋이 맞나"가 배포 후 첫 질문이라서다.
 *
 * 인증을 걸지 않는다: 호출 주체가 업타임 모니터·배포 스모크라 시크릿을 쥐여줄 자리가 없고,
 * 새는 것은 마이그레이션 개수와 커밋 SHA뿐이다. 대신 DB 왕복을 1회로 묶어, 두들겨 맞아도
 * 부하가 쿼리 하나에 그치게 한다(cron 라우트와 달리 여기서 fail-closed는 자해다 —
 * 헬스체크가 401이면 배포 상태를 볼 수단 자체가 사라진다).
 */
export async function GET() {
  try {
    // count(*)는 bigint로 돌아오고 JSON.stringify는 bigint에서 throw한다 — SQL에서 int로
    // 내려 받는다. rolled_back_at 조건은 되돌린 마이그레이션이 개수에 남지 않게 한다.
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;

    return Response.json({
      status: 'ok',
      migrations: rows[0]?.count ?? 0,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    });
  } catch (error) {
    // 원인은 로그에만 남긴다 — 연결 문자열이 통째로 실린 예외를 공개 엔드포인트가 그대로
    // 돌려주면 자격증명이 샌다. 200이 아닌 것이 신호고, 무엇이 틀렸는지는 배포 로그에서 본다.
    console.error('[health]', error);
    return Response.json({ status: 'error' }, { status: 503 });
  }
}
