import 'server-only';

import { prisma } from '@/server/db';
import { Prisma } from '@/server/generated/prisma/client';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { orgSkeleton, userSkeleton } from '@/server/services/skeleton';

// 노트 즐겨찾기 (KAN-37). 행의 존재가 곧 상태다 — 토글은 '지워봐서 없었으면 만든다'.
// 사용자별 상태라 소유권 판정이 없다: 자기 즐겨찾기는 자기 것이고, 대상 노트는 같은
// org면 누구의 것이든 접을 수 있다(노트 열람이 org 전체 공개인 것과 같은 경계).

export type ToggleFavoriteOutcome =
  | { status: 'ok'; favorited: boolean }
  | { status: 'notfound' };

export async function toggleFavorite(
  orgId: string,
  userId: string,
  noteId: string,
): Promise<ToggleFavoriteOutcome> {
  // 노트 실존 + org 스코프 — 남의 워크스페이스 노트 id로는 행이 만들어지지 않는다.
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId },
    select: { id: true },
  });
  if (!note) return { status: 'notfound' };

  // 끄기 경로. orgId까지 물어 확인·삭제가 같은 스코프를 보게 한다.
  const { count } = await prisma.noteFavorite.deleteMany({
    where: { noteId, userId, orgId },
  });
  if (count > 0) return { status: 'ok', favorited: false };

  // 켜기 — 미러가 아직 없을 수 있어 스켈레톤과 한 트랜잭션 + tombstone pre/post
  // (createNote와 같은 패턴). createMany+skipDuplicates라 동시 켜기 경합은 한 행으로
  // 수렴하고 둘 다 '켜짐'을 보고받는다(토글 의미와 일치).
  await assertNotTombstoned([orgId, userId]);
  try {
    await prisma.$transaction([
      orgSkeleton(orgId),
      userSkeleton(userId),
      prisma.noteFavorite.createMany({
        data: [{ noteId, userId, orgId }],
        skipDuplicates: true,
      }),
    ]);
  } catch (error) {
    // 실존 확인과 INSERT 사이에 노트가 지워진 경합 — FK 위반(P2003)은 '없는 노트'다.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return { status: 'notfound' };
    }
    throw error;
  }
  await assertNotTombstoned([orgId, userId], async () => {
    await prisma.noteFavorite.deleteMany({ where: { noteId, userId } });
  });

  return { status: 'ok', favorited: true };
}

// 사이드바 즐겨찾기 섹션용 — 노드 정보는 트리 조회가 이미 들고 있으므로 id만 내린다.
// 정렬은 즐겨찾은 순서(오래된 것부터) — 별을 누른 순서가 곧 목록 순서다.
export async function listFavoriteNoteIds(orgId: string, userId: string): Promise<string[]> {
  const rows = await prisma.noteFavorite.findMany({
    where: { orgId, userId },
    select: { noteId: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => row.noteId);
}
