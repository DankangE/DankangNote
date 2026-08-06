-- DropIndex
DROP INDEX "Note_orgId_idx";

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "NoteFavorite" (
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteFavorite_pkey" PRIMARY KEY ("noteId","userId")
);

-- CreateIndex
CREATE INDEX "NoteFavorite_userId_orgId_idx" ON "NoteFavorite"("userId", "orgId");

-- CreateIndex
CREATE INDEX "NoteFavorite_orgId_idx" ON "NoteFavorite"("orgId");

-- CreateIndex
CREATE INDEX "Note_orgId_parentId_idx" ON "Note"("orgId", "parentId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteFavorite" ADD CONSTRAINT "NoteFavorite_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteFavorite" ADD CONSTRAINT "NoteFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteFavorite" ADD CONSTRAINT "NoteFavorite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
