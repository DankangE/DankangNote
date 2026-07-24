-- 문장별 자동커밋으로 인한 반쪽 상태 방지 — 전체를 한 트랜잭션으로 (KAN-14 관례).
BEGIN;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "clerkUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "clerkUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clerkUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ClerkTombstone" (
    "id" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClerkTombstone_pkey" PRIMARY KEY ("id")
);

COMMIT;
