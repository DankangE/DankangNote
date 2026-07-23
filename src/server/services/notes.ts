import 'server-only';

import { prisma } from '@/server/db';
import { Prisma } from '@/server/generated/prisma/client';
import type { Note, User } from '@/server/generated/prisma/client';

export interface NoteInput {
  title: string;
  content?: string;
}

// 작성자는 표시에 필요한 최소 필드만 노출한다 (미러 User의 imageUrl 등은 아직 불필요).
const AUTHOR_SELECT = { id: true, firstName: true, lastName: true, email: true } as const;

export type NoteAuthor = Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;
// author: 소급 이전 노트·탈퇴 작성자(SetNull)는 null.
export type NoteWithAuthor = Note & { author: NoteAuthor | null };

export function listNotes(orgId: string): Promise<NoteWithAuthor[]> {
  return prisma.note.findMany({
    where: { orgId },
    include: { author: { select: AUTHOR_SELECT } },
    orderBy: { updatedAt: 'desc' },
  });
}

export function getNote(orgId: string, id: string): Promise<NoteWithAuthor | null> {
  return prisma.note.findFirst({
    where: { id, orgId },
    include: { author: { select: AUTHOR_SELECT } },
  });
}

// 생성은 org/작성자 스켈레톤 생성(create-if-absent)과 한 트랜잭션 — webhook이 아직
// 미러를 채우기 전이어도 FK가 성립한다(부트스트랩 경합 회피, KAN-11 멤버십과 동일 패턴).
// 스켈레톤의 실제 값(name·이메일 등)은 webhook 이벤트가 나중에 채운다.
// upsert가 아닌 createMany+skipDuplicates인 이유: Prisma 7 쿼리 컴파일러는 upsert를
// SELECT→INSERT로 에뮬레이션해 동시 생성 시 P2002로 죽지만, 이 형태는 네이티브
// INSERT ... ON CONFLICT DO NOTHING으로 컴파일된다.
// 잔여 한계: user/org 삭제 직후 stale 세션(토큰 만료 전)의 생성이 스켈레톤을 부활시킬
// 수 있다 — webhook 부활 경로와 함께 KAN-12에서 다룬다.
export async function createNote(
  orgId: string,
  authorId: string,
  input: NoteInput,
): Promise<NoteWithAuthor> {
  const [, , note] = await prisma.$transaction([
    prisma.organization.createMany({
      // name은 세션에서 알 수 없다 — 임시로 orgId를 쓰고 organization.* webhook이 교정.
      data: [{ id: orgId, name: orgId }],
      skipDuplicates: true,
    }),
    prisma.user.createMany({
      data: [{ id: authorId }],
      skipDuplicates: true,
    }),
    prisma.note.create({
      data: { ...input, orgId, authorId },
      include: { author: { select: AUTHOR_SELECT } },
    }),
  ]);
  return note;
}

// update/delete 모두 where에 orgId를 포함해 타 워크스페이스 접근을 막는다.
// update는 확장 where-unique({ id, orgId })로 단건 원자 실행 — updateMany 후
// 재조회하면 그 사이 삭제와 경합해 성공한 수정을 실패로 보고할 수 있다.
export async function updateNote(
  orgId: string,
  id: string,
  input: Partial<NoteInput>,
): Promise<NoteWithAuthor | null> {
  try {
    return await prisma.note.update({
      where: { id, orgId },
      data: input,
      include: { author: { select: AUTHOR_SELECT } },
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
