-- CreateTable
CREATE TABLE "NoteCommentThread" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "authorId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteCommentThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteComment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteCommentThread_noteId_createdAt_idx" ON "NoteCommentThread"("noteId", "createdAt");

-- CreateIndex
CREATE INDEX "NoteCommentThread_orgId_idx" ON "NoteCommentThread"("orgId");

-- CreateIndex
CREATE INDEX "NoteCommentThread_authorId_idx" ON "NoteCommentThread"("authorId");

-- CreateIndex
CREATE INDEX "NoteComment_threadId_createdAt_idx" ON "NoteComment"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "NoteComment_orgId_idx" ON "NoteComment"("orgId");

-- CreateIndex
CREATE INDEX "NoteComment_authorId_idx" ON "NoteComment"("authorId");

-- AddForeignKey
ALTER TABLE "NoteCommentThread" ADD CONSTRAINT "NoteCommentThread_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteCommentThread" ADD CONSTRAINT "NoteCommentThread_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteCommentThread" ADD CONSTRAINT "NoteCommentThread_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteComment" ADD CONSTRAINT "NoteComment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteComment" ADD CONSTRAINT "NoteComment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "NoteCommentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteComment" ADD CONSTRAINT "NoteComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
