-- KAN-30: 스레드(답글). parentId가 null이면 채널 본문에 보이는 루트, 값이 있으면 그 루트의
-- 답글이다. 기존 메시지는 전부 루트이므로 백필이 필요 없다(nullable + 기본 null).
--
-- 인덱스 교체: 채널 본문 목록이 이제 parentId IS NULL을 함께 묻는다. (channelId, createdAt)
-- 만으로는 그 조건이 인덱스 밖 필터로 남아, 답글이 쌓일수록 루트 한 페이지를 뽑는 데
-- 훑는 행이 늘어난다. 가운데에 parentId를 끼우면 (등호, 등호, 범위) 형태가 되어
-- KAN-29 키셋 커서의 시작 경계도 그대로 유지된다.
-- DropIndex
DROP INDEX "ChatMessage_channelId_createdAt_idx";

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_parentId_createdAt_idx" ON "ChatMessage"("channelId", "parentId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_parentId_createdAt_idx" ON "ChatMessage"("parentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
