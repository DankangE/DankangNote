-- KAN-19: ChatMessage를 테넌트 수명 정책 안으로 들인다.
--
-- 지금까지 ChatMessage에는 FK가 없어 organization.deleted webhook의 cascade가 닿지
-- 않았다. 그래서 이미 삭제된 워크스페이스의 메시지가 고아로 남아 있을 수 있고, 그 상태로는
-- 아래 FK를 걸 수 없다. 조직 삭제 = 그 조직 데이터 파기(KAN-14에서 확정한 테넌트 수명
-- 정책)이므로, 원래 파기됐어야 할 고아 메시지를 먼저 지우고 제약을 건다.
DELETE FROM "ChatMessage"
WHERE "orgId" NOT IN (SELECT "id" FROM "Organization");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
