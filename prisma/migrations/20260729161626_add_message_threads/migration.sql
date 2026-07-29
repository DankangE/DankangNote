-- KAN-30: 스레드(답글). parentId가 null이면 채널 본문에 보이는 루트, 값이 있으면 그 루트의
-- 답글이다. 기존 메시지는 전부 루트이므로 백필이 필요 없다(nullable + 기본 null).
--
-- 인덱스는 KAN-29의 (channelId, createdAt)를 그대로 둔다. 채널 본문이 parentId IS NULL을
-- 함께 묻게 됐지만 그건 인덱스 밖 필터로 두는 편이 낫다 — IS NULL은 등호가 아니라
-- NullTest라, parentId를 인덱스 가운데에 끼우면 정렬 pathkey가 성립하지 않아 역스캔 대신
-- Sort가 붙는다(실측). 답글이 96%인 채널에서도 현 형태가 52행만 읽고 끝난다.
-- 스레드 조회는 parentId가 등호라 아래 (parentId, createdAt)가 정렬까지 해결한다.

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "ChatMessage_parentId_createdAt_idx" ON "ChatMessage"("parentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
