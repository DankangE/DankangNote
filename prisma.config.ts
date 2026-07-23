import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
    // migrate diff/dev가 마이그레이션 재생에 쓰는 격리 DB. 없으면 기존 동작 그대로다.
    // 공유 dev DB에 병행 브랜치의 마이그레이션이 섞여 있을 때 reset 없이 diff하려면 필요.
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
