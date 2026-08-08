-- KAN-71 — 노트 첨부의 참조를 1:1(NoteAttachment.noteId)에서 1:N(NoteAttachmentRef)으로.
--
-- 순서가 중요하다: 표를 먼저 만들고 **기존 바인딩을 옮긴 뒤** 컬럼을 드롭한다.
-- prisma migrate가 만든 초안은 곧바로 DROP COLUMN이라 이미 저장된 본문 이미지의 바인딩이
-- 전부 사라진다(그러면 참조가 0이 되어 다음 스윕이 오브젝트까지 지운다).

-- CreateTable
CREATE TABLE "NoteAttachmentRef" (
    "noteId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,

    CONSTRAINT "NoteAttachmentRef_pkey" PRIMARY KEY ("noteId","attachmentId")
);

-- CreateIndex
CREATE INDEX "NoteAttachmentRef_attachmentId_idx" ON "NoteAttachmentRef"("attachmentId");

-- AddForeignKey
ALTER TABLE "NoteAttachmentRef" ADD CONSTRAINT "NoteAttachmentRef_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAttachmentRef" ADD CONSTRAINT "NoteAttachmentRef_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "NoteAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 기존 바인딩 이관 (noteId NULL = pending은 옮길 것이 없다).
INSERT INTO "NoteAttachmentRef" ("noteId", "attachmentId")
SELECT "noteId", "id" FROM "NoteAttachment" WHERE "noteId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "NoteAttachment" DROP CONSTRAINT "NoteAttachment_noteId_fkey";

-- DropIndex
DROP INDEX "NoteAttachment_noteId_idx";

-- AlterTable
ALTER TABLE "NoteAttachment" DROP COLUMN "noteId";
