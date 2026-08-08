-- KAN-39 — 실시간 공동 편집(Yjs CRDT)의 저장 구조.
--
-- Note.docState: Yjs 문서의 접힌 상태. null이면 아직 공동 편집이 시작되지 않은 노트이고,
-- 그때는 content가 유일한 진실이라 첫 편집자가 옮겨 담는다.
--
-- NoteDocUpdate: 도착 순서대로 쌓는 업데이트 로그. CRDT 델타는 교환법칙이 성립해 순서와
-- 무관하게 수렴하므로 잠금이 필요 없다 — 반대로 매 타건을 한 행 UPDATE로 받으면 그 행이
-- 문서 전체 편집의 직렬화 지점이 된다. 주기적으로 docState로 접고 접힌 몫을 지운다.

-- AlterTable
ALTER TABLE "Note" ADD COLUMN "docState" BYTEA;

-- CreateTable
CREATE TABLE "NoteDocUpdate" (
    "id" BIGSERIAL NOT NULL,
    "noteId" TEXT NOT NULL,
    "update" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteDocUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — '이 노트의 id > N' 조회가 유일한 접근 패턴이다(따라잡기·접기 둘 다).
CREATE INDEX "NoteDocUpdate_noteId_id_idx" ON "NoteDocUpdate"("noteId", "id");

-- AddForeignKey
ALTER TABLE "NoteDocUpdate" ADD CONSTRAINT "NoteDocUpdate_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
