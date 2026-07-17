import 'server-only';

import { prisma } from '@/server/db';
import { Prisma } from '@/server/generated/prisma/client';
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

// update/delete 모두 where에 orgId를 포함해 타 워크스페이스 접근을 막는다.
// update는 확장 where-unique({ id, orgId })로 단건 원자 실행 — updateMany 후
// 재조회하면 그 사이 삭제와 경합해 성공한 수정을 실패로 보고할 수 있다.
export async function updateNote(
  orgId: string,
  id: string,
  input: Partial<NoteInput>,
): Promise<Note | null> {
  try {
    return await prisma.note.update({
      where: { id, orgId },
      data: input,
    });
  } catch (error) {
    // P2025: 조건에 맞는 레코드 없음 (미존재 또는 타 org 소유)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }
    throw error;
  }
}

export async function deleteNote(orgId: string, id: string): Promise<boolean> {
  const { count } = await prisma.note.deleteMany({ where: { id, orgId } });
  return count > 0;
}
