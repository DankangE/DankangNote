-- KAN-28: '워크스페이스당 방 1개'(KAN-15)를 채널 모델로 대체한다.
--
-- ChatMessage.channelId는 NOT NULL이지만 기존 메시지가 이미 있다. 그래서 순서가 중요하다:
-- ① 채널 테이블 생성 → ② org마다 기본 채널 '일반' 생성 → ③ 기존 메시지를 그 채널로 백필
-- → ④ 그제서야 NOT NULL + FK. Prisma가 만든 기본 SQL(빈 테이블 가정: ADD COLUMN NOT NULL)은
-- 운영 데이터에서 실패하므로 아래처럼 손으로 갈랐다.

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMember" (
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMember_pkey" PRIMARY KEY ("channelId","userId")
);

-- CreateIndex
CREATE INDEX "Channel_orgId_idx" ON "Channel"("orgId");

-- CreateIndex
CREATE INDEX "Channel_createdById_idx" ON "Channel"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_orgId_name_key" ON "Channel"("orgId", "name");

-- CreateIndex
CREATE INDEX "ChannelMember_userId_idx" ON "ChannelMember"("userId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 백필 ①: 모든 기존 워크스페이스에 기본 채널 '일반'을 만든다. 앱의 ensureDefaultChannel과
-- 같은 이름·같은 뜻이라, 마이그레이션 직후 접속해도 새 채널이 하나 더 생기지 않는다.
-- id는 gen_random_uuid()(PG13+ 코어 내장) — cuid를 SQL에서 만들 수 없어서다. Channel.id는
-- 불투명 문자열이므로 형식이 섞여도 무방하다.
INSERT INTO "Channel" ("id", "orgId", "name", "topic", "isPrivate", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", '일반', '워크스페이스 멤버 전체 대화', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization";

-- 컬럼은 nullable로 먼저 붙인다 — 기존 행에 값이 없어 NOT NULL로는 못 만든다.
ALTER TABLE "ChatMessage" ADD COLUMN "channelId" TEXT;

-- 백필 ②: 기존 메시지를 자기 org의 기본 채널로 옮긴다. ChatMessage.orgId에는 이미
-- FK(KAN-19)가 있어 org 없는 고아 메시지는 존재할 수 없고, 위 INSERT가 모든 org를 덮으므로
-- 여기서 채널을 못 찾는 행은 없다 — 그래서 곧바로 SET NOT NULL을 걸 수 있다.
UPDATE "ChatMessage" AS m
SET "channelId" = c."id"
FROM "Channel" AS c
WHERE c."orgId" = m."orgId" AND c."isDefault";

ALTER TABLE "ChatMessage" ALTER COLUMN "channelId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_createdAt_idx" ON "ChatMessage"("channelId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 기존 멤버의 ChannelMember 백필은 하지 않는다. 기본 채널 참여는 앱이 첫 접속 때
-- 보장하고(ensureDefaultChannel), 여기서 Membership 미러를 복사하면 웹훅 지연으로 아직
-- 미러에 없는 멤버만 빠지는 어중간한 상태가 된다.
