import 'server-only';

import { prisma } from '@/server/db';
import type { Note } from '@/server/generated/prisma/client';

export interface NoteInput {
  title: string;
  content?: string;
}

export function listNotes(orgId: string): Promise<Note[]> {
  return prisma.note.findMany({
    where: { orgId },
    orderBy: { updatedAt: 'desc' },
  });
}

export function getNote(orgId: string, id: string): Promise<Note | null> {
  return prisma.note.findFirst({ where: { id, orgId } });
}

export function createNote(orgId: string, input: NoteInput): Promise<Note> {
  return prisma.note.create({ data: { ...input, orgId } });
}

// update/delete는 id가 유니크라도 orgId 스코프를 강제하기 위해
// *Many 변형을 쓴다 — 단건 update({ where: { id } })는 타 워크스페이스 접근을 못 막는다.
export async function updateNote(
  orgId: string,
  id: string,
  input: Partial<NoteInput>,
): Promise<Note | null> {
  const { count } = await prisma.note.updateMany({
    where: { id, orgId },
    data: input,
  });
  if (count === 0) return null;
  return getNote(orgId, id);
}

export async function deleteNote(orgId: string, id: string): Promise<boolean> {
  const { count } = await prisma.note.deleteMany({ where: { id, orgId } });
  return count > 0;
}
