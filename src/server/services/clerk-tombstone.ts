import 'server-only';

import { prisma } from '@/server/db';

// Clerk가 삭제를 통보한 id의 영구 기록 조회 (KAN-12 순서 역전 가드).
// clerk-sync의 upsert pre/post-check와 notes.createNote의 스켈레톤 생성 가드가 공유한다.
export async function findTombstoned(ids: readonly string[]): Promise<string[]> {
  const rows = await prisma.clerkTombstone.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

// 스켈레톤 생성(org/user create-if-absent) 경로의 tombstone 가드. 삭제된 Clerk 리소스가
// 걸리면 되살아난 스켈레톤을 정리하고 throw한다 — pre/post 이중 확인용(notes.createNote 참조).
// board.createColumn/createCard가 공유한다. post-check에서는 onRevive로 방금 만든 엔티티를
// 함께 지운다(org tombstone이면 cascade로 이미 지워졌을 수 있어 idempotent).
export async function assertNotTombstoned(
  ids: readonly (string | null | undefined)[],
  onRevive?: () => Promise<void>,
): Promise<void> {
  const candidates = ids.filter((id): id is string => Boolean(id));
  if (candidates.length === 0) return;
  const dead = await findTombstoned(candidates);
  if (dead.length === 0) return;
  if (onRevive) await onRevive();
  // org 삭제는 cascade로 하위(컬럼·카드·노트)까지 정리한다.
  await prisma.organization.deleteMany({ where: { id: { in: dead } } });
  await prisma.user.deleteMany({ where: { id: { in: dead } } });
  throw new Error(`삭제된 Clerk 리소스로 생성 시도: ${dead.join(', ')}`);
}
