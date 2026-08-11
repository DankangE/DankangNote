import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // 앱은 풀러 경유로 붙지만(서버리스는 요청마다 커넥션을 연다) **마이그레이션은 직결이어야
    // 한다**. migrate가 잡는 어드바이저리 락은 세션에 매달리는데, 풀러 뒤에서는 후속 쿼리가
    // 다른 세션으로 갈 수 있어 락을 되찾지 못하고 그대로 멈춘다 — 실패가 아니라 정지라
    // 빌드가 타임아웃까지 매달린다. 로컬·CI에는 풀러가 없어 값이 비고, 그때는 예전과 똑같이
    // DATABASE_URL을 쓴다(CI가 db execute에 DATABASE_URL을 인라인으로 덮는 경로도 그대로).
    //
    // 이름을 DIRECT_… 같은 우리 식으로 짓지 않고 DATABASE_URL_UNPOOLED로 둔 것이 핵심이다
    // (KAN-77). Neon-Vercel 통합이 배포마다 DATABASE_URL(풀러)과 이 키(직결)를 **짝으로**
    // 주입하는데, 우리가 다른 이름을 쓰면 그 키는 Vercel에 손으로 박은 고정값이 된다 —
    // 프리뷰 앱은 프리뷰 브랜치 DB를 보면서 그 빌드는 스테이징 DB를 마이그레이션하는
    // 엇갈림이 생긴다. 주입되는 이름을 그대로 읽으면 짝이 절대 어긋나지 않는다.
    // ??가 아니라 ||인 것은 빈 문자열 때문이다 — .env에서 키를 값 없이 남겨 두는 것이
    // '끄는' 동작으로 읽히는데, ??는 ""를 유효한 값으로 넘겨 prisma가 엉뚱하게 죽는다.
    url: process.env["DATABASE_URL_UNPOOLED"] || process.env["DATABASE_URL"],
    // migrate diff/dev가 마이그레이션 재생에 쓰는 격리 DB. 없으면 기존 동작 그대로다.
    // 공유 dev DB에 병행 브랜치의 마이그레이션이 섞여 있을 때 reset 없이 diff하려면 필요.
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
