-- Prisma 네이티브 스키마 엔진은 문장별 자동커밋한다 — 중간 실패 시 비멱등 반쪽 상태가
-- 남지 않도록 전체를 한 트랜잭션으로 감싼다 (백필↔FK 제약 사이 틈도 함께 닫힘).
BEGIN;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "authorId" TEXT;

-- CreateIndex
CREATE INDEX "Note_authorId_idx" ON "Note"("authorId");

-- 백필 (수기): FK 제약을 걸기 전에, 기존 노트가 참조하지만 미러에 없는 orgId를
-- 스켈레톤 Organization으로 생성한다. name은 임시로 orgId — webhook organization.*
-- 이벤트가 실제 값으로 교정한다. authorId는 신규 nullable 컬럼이라 백필 불필요.
INSERT INTO "Organization" ("id", "name", "updatedAt")
SELECT DISTINCT n."orgId", n."orgId", CURRENT_TIMESTAMP
FROM "Note" n
LEFT JOIN "Organization" o ON o."id" = n."orgId"
WHERE o."id" IS NULL;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
