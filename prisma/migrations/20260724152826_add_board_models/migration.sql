-- CreateTable
CREATE TABLE "BoardColumn" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardCard" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardColumn_orgId_idx" ON "BoardColumn"("orgId");

-- CreateIndex
CREATE INDEX "BoardCard_orgId_idx" ON "BoardCard"("orgId");

-- CreateIndex
CREATE INDEX "BoardCard_columnId_idx" ON "BoardCard"("columnId");

-- CreateIndex
CREATE INDEX "BoardCard_authorId_idx" ON "BoardCard"("authorId");

-- AddForeignKey
ALTER TABLE "BoardColumn" ADD CONSTRAINT "BoardColumn_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCard" ADD CONSTRAINT "BoardCard_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCard" ADD CONSTRAINT "BoardCard_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "BoardColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCard" ADD CONSTRAINT "BoardCard_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
