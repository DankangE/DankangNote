import 'server-only';

import { prisma } from '@/server/db';
import type { Note } from '@/server/generated/prisma/client';
import { ownedNoteWhere, type NoteActor } from '@/server/services/notes';

// 문서 트리 (KAN-37). 조회는 flat 목록으로 내리고 트리 조립은 클라이언트가 한다
// (features/notes/tree.ts) — 사이드바는 어차피 전 노드를 렌더하므로 서버에서 중첩
// 구조를 만들 이유가 없고, flat이면 (orgId, parentId) 인덱스 정렬을 그대로 탄다.

// 사이드바용 최소 노드 — 전 노트를 한 번에 긁는 조회라 content를 실으면 트리 하나에
// 워크스페이스의 모든 문서 본문이 실려 온다.
const TREE_SELECT = {
  id: true,
  title: true,
  parentId: true,
  position: true,
  authorId: true,
} as const;

export type NoteTreeNode = Pick<Note, keyof typeof TREE_SELECT>;

// 정렬은 형제 그룹 안에서만 의미가 있다 — (position, createdAt)이 그룹 내 순서를
// 결정하고(중복 position은 생성 경합·SetNull 승격의 산물, createdAt이 타이브레이커),
// 그룹 간 인터리빙은 클라이언트 트리 조립이 무시한다.
export function listNoteTree(orgId: string): Promise<NoteTreeNode[]> {
  return prisma.note.findMany({
    where: { orgId },
    select: TREE_SELECT,
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
}

export type MoveOutcome = 'ok' | 'forbidden' | 'notfound' | 'invalidparent' | 'cycle';

// 이동 = 재부모화 + 대상 형제 그룹 안의 위치 지정. index는 이동 노트를 뺀 대상 그룹
// 기준의 삽입 위치다(범위 밖은 클램프).
//
// 사이클 방지가 이 함수가 따로 있는 이유다 — '내 자손 밑으로 이동'이 한 번 들어오면
// 그 가지 전체가 루트에서 끊겨 조회 불가능한 고아 사이클이 된다. DB 제약으로는 표현할
// 수 없어 재귀 CTE로 대상 부모의 조상 사슬을 걷어 확인한다.
//
// 트랜잭션 전체를 org 단위 advisory lock으로 직렬화한다. 동시 이동 두 건(A→B 아래,
// B→A 아래)이 각자 검사 시점엔 사이클이 아니어서 둘 다 통과한 뒤 커밋되면 상호 부모가
// 성립한다 — 잠금 없이 CTE 검사만으로는 못 막는다. 이동은 드문 조작이라 org 직렬화
// 비용보다 불변식이 싸다(규약 20이 채널 행 잠금을 고른 것과 같은 저울질).
export async function moveNote(
  orgId: string,
  id: string,
  target: { parentId: string | null; index: number },
  actor: NoteActor,
): Promise<MoveOutcome> {
  if (target.parentId === id) return 'cycle';

  return prisma.$transaction(async (tx) => {
    // hashtextextended의 두 번째 인자는 시드 — 다른 용도의 advisory lock과 키 공간이
    // 겹치지 않게 티켓 번호(37)를 박아 둔다.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${orgId}, 37))`;

    // 이동도 노트 행의 update다 — 수정·삭제와 같은 소유권 판정(작성자 또는 admin, KAN-18).
    const note = await tx.note.findFirst({
      where: ownedNoteWhere(orgId, id, actor),
      select: { id: true, parentId: true, position: true },
    });
    if (!note) {
      const exists = await tx.note.findFirst({ where: { id, orgId }, select: { id: true } });
      return exists ? 'forbidden' : 'notfound';
    }

    if (target.parentId !== null) {
      // 대상 부모의 조상 사슬(자기 자신 포함). 비어 있으면 부모가 이 org에 없다 —
      // 교차 테넌트 id도 여기서 걸러진다(첫 SELECT에 orgId 스코프).
      const chain = await tx.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE chain AS (
          SELECT "id", "parentId" FROM "Note"
            WHERE "id" = ${target.parentId} AND "orgId" = ${orgId}
          UNION ALL
          SELECT n."id", n."parentId" FROM "Note" n JOIN chain c ON n."id" = c."parentId"
        )
        SELECT "id" FROM chain
      `;
      if (chain.length === 0) return 'invalidparent';
      if (chain.some((row) => row.id === id)) return 'cycle';
    }

    // 대상 그룹(이동 노트 제외)을 현재 순서로 읽어 index에 끼우고 0..n으로 재작성.
    // 위치가 이미 맞는 형제는 건너뛴다 — 재정렬이 남의 노트 updatedAt까지 밀어 올리면
    // '구조를 만졌을 뿐인데 수정한 사람'이 되기 때문에 쓰기 자체를 안 낸다.
    const siblings = await tx.note.findMany({
      where: { orgId, parentId: target.parentId, id: { not: id } },
      select: { id: true, position: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    const at = Math.max(0, Math.min(target.index, siblings.length));
    // 이동 노트의 position은 부모가 바뀌면 -1(항상 불일치)로 둬서 반드시 쓰이게 한다.
    const ordered: Array<{ id: string; position: number }> = [
      ...siblings.slice(0, at),
      { id, position: note.parentId === target.parentId ? note.position : -1 },
      ...siblings.slice(at),
    ];
    for (const [index, row] of ordered.entries()) {
      if (row.position === index) continue;
      await tx.note.updateMany({
        where: { id: row.id, orgId },
        data: row.id === id ? { parentId: target.parentId, position: index } : { position: index },
      });
    }
    return 'ok';
  });
}
