-- KAN-74 — 스윕이 후보를 인덱스로 좁힐 수 있게 참조 수를 NoteAttachment에 옮겨 둔다.
--
-- 판정의 권위는 여전히 NoteAttachmentRef에 있다(삭제문이 NOT EXISTS로 다시 본다).
-- 이 컬럼과 부분 인덱스는 **스캔 범위를 쓰레기 양에 비례하게** 만드는 것이 목적이다:
-- 조인 표에만 조건이 있으면 계획이 전체 안티조인이라 LIMIT이 지우는 행만 묶고 스캔은
-- 안 묶는다(600만 행에서 5초 트랜잭션 타임아웃 실측).

-- AlterTable
ALTER TABLE "NoteAttachment" ADD COLUMN "refCount" INTEGER NOT NULL DEFAULT 0;

-- 기존 행 백필 — 참조가 있는 것만 세면 된다(없는 것은 기본값 0).
UPDATE "NoteAttachment" a
SET "refCount" = c.n
FROM (
  SELECT "attachmentId" AS id, count(*)::int AS n
  FROM "NoteAttachmentRef"
  GROUP BY "attachmentId"
) c
WHERE a."id" = c.id;

-- 스윕의 후보 조회 전용 부분 인덱스. 참조가 남은 행(대다수)은 아예 인덱스에 없으므로
-- 크기가 '아직 안 쓰이는 첨부' 수에 비례한다. ORDER BY "createdAt"으로 걷는다.
CREATE INDEX "NoteAttachment_unreferenced_createdAt_idx"
  ON "NoteAttachment"("createdAt")
  WHERE "refCount" = 0;
