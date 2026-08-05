-- CreateTable
CREATE TABLE "RateLimit" (
    "userId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "lastAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("userId","resource")
);
