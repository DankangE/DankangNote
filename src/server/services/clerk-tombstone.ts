import 'server-only';

import { prisma } from '@/server/db';

// Clerk가 삭제를 통보한 id의 영구 기록 조회 (KAN-12 순서 역전 가드).
// clerk-sync의 upsert pre/post-check와 notes.createNote의 스켈레톤 생성 가드가 공유한다.
export async function findTombstoned(ids: readonly (string | null)[]): Promise<string[]> {
  const valid = ids.filter((id): id is string => id !== null);
  if (valid.length === 0) return [];
  const rows = await prisma.clerkTombstone.findMany({
    where: { id: { in: valid } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
