-- KAN-55: 메시지 정렬·읽음 커서의 근거를 앱 프로세스 시계에서 채널 순번으로 옮긴다.
--
-- 기존 행에는 시각 말고 순서의 근거가 없으므로 백필은 (createdAt, id) — 지금까지 쓰던
-- 정렬 그대로 — 를 순번으로 번역한다. 과거의 역전까지 되살릴 방법은 없지만, 적어도
-- 지금 화면에 보이는 순서와 어긋나지는 않는다.

-- 1) 채널 카운터. 아래에서 채널별 최대 순번으로 맞춘다.
ALTER TABLE "Channel" ADD COLUMN "messageSeq" INTEGER NOT NULL DEFAULT 0;

-- 2) 메시지 순번. 백필 전에는 NULL을 허용해야 한다.
ALTER TABLE "ChatMessage" ADD COLUMN "seq" INTEGER;

UPDATE "ChatMessage" AS m
SET "seq" = numbered."rn"
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "channelId" ORDER BY "createdAt", "id") AS "rn"
  FROM "ChatMessage"
) AS numbered
WHERE m."id" = numbered."id";

ALTER TABLE "ChatMessage" ALTER COLUMN "seq" SET NOT NULL;

UPDATE "Channel" AS c
SET "messageSeq" = COALESCE(
  (SELECT max(m."seq") FROM "ChatMessage" AS m WHERE m."channelId" = c."id"),
  0
);

-- 3) 참여 기준선. 참여 시각까지 이미 와 있던 메시지의 최대 순번 — 그 뒤부터가 안읽음이다.
--    시각 비교는 여기서 마지막으로 한 번만 쓴다(다른 근거가 없다).
ALTER TABLE "ChannelMember" ADD COLUMN "joinedSeq" INTEGER NOT NULL DEFAULT 0;

UPDATE "ChannelMember" AS cm
SET "joinedSeq" = COALESCE(
  (
    SELECT max(m."seq")
    FROM "ChatMessage" AS m
    WHERE m."channelId" = cm."channelId" AND m."createdAt" <= cm."createdAt"
  ),
  0
);

-- 4) 읽음 커서를 순번 하나로. 기존 커서가 가리키던 메시지의 순번을 그대로 옮긴다.
--    그 메시지가 사라졌다면(현재 삭제 경로는 없지만 cascade가 있다) 0으로 떨어뜨린다 —
--    안 읽은 것을 읽었다고 하는 것보다 이미 읽은 것이 다시 뜨는 쪽이 낫다.
ALTER TABLE "ChannelRead" ADD COLUMN "lastReadSeq" INTEGER;

UPDATE "ChannelRead" AS r
SET "lastReadSeq" = COALESCE(
  (SELECT m."seq" FROM "ChatMessage" AS m WHERE m."id" = r."lastReadId"),
  0
);

ALTER TABLE "ChannelRead" ALTER COLUMN "lastReadSeq" SET NOT NULL;
ALTER TABLE "ChannelRead" DROP COLUMN "lastReadAt";
ALTER TABLE "ChannelRead" DROP COLUMN "lastReadId";

-- 5) 인덱스 교체. (channelId, seq)는 unique — 한 채널에 같은 번호가 둘이면 커서가 어느
--    쪽을 가리키는지 정할 수 없다. 카운터를 우회한 쓰기는 여기서 죽어야 한다.
DROP INDEX "ChatMessage_channelId_createdAt_idx";
DROP INDEX "ChatMessage_parentId_createdAt_idx";
CREATE UNIQUE INDEX "ChatMessage_channelId_seq_key" ON "ChatMessage"("channelId", "seq");
CREATE INDEX "ChatMessage_parentId_seq_idx" ON "ChatMessage"("parentId", "seq");
