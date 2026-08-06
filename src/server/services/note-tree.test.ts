import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  ORG_A,
  ORG_B,
  USER_ADMIN,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedTenants,
} from '../../../test/db';
import { createNote } from './notes';
import { listNoteTree, moveNote } from './note-tree';

const owner = { userId: USER_OWNER, isAdmin: false };
const other = { userId: USER_OTHER, isAdmin: false };
const admin = { userId: USER_ADMIN, isAdmin: true };

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
});

async function noteIn(
  orgId: string,
  title: string,
  parentId: string | null = null,
  position = 0,
): Promise<string> {
  const note = await prisma.note.create({
    data: { orgId, authorId: USER_OWNER, title, parentId, position },
  });
  return note.id;
}

// 현재 트리를 '부모 id → 자식 title 배열'로 요약한다 — 순서까지 검증하기 위함.
async function childrenOf(orgId: string, parentId: string | null): Promise<string[]> {
  const rows = await prisma.note.findMany({
    where: { orgId, parentId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { title: true },
  });
  return rows.map((row) => row.title);
}

describe('하위 문서 생성 (KAN-37)', () => {
  it('parentId를 주면 그 부모의 형제 그룹 끝에 붙는다', async () => {
    const root = await noteIn(ORG_A, '루트');
    await noteIn(ORG_A, '기존 자식', root, 0);

    const created = await createNote(ORG_A, USER_OWNER, { title: '새 자식', parentId: root });

    expect(created.status).toBe('ok');
    expect(await childrenOf(ORG_A, root)).toEqual(['기존 자식', '새 자식']);
  });

  it('다른 org의 노트를 부모로 지정하면 invalidparent다', async () => {
    const rootInB = await noteIn(ORG_B, 'B의 루트');

    const created = await createNote(ORG_A, USER_OWNER, { title: '침투', parentId: rootInB });

    expect(created.status).toBe('invalidparent');
    expect(await prisma.note.count({ where: { orgId: ORG_A } })).toBe(0);
    // B의 트리에도 매달리지 않았다.
    expect(await prisma.note.count({ where: { parentId: rootInB } })).toBe(0);
  });

  it('없는 부모도 invalidparent다', async () => {
    const created = await createNote(ORG_A, USER_OWNER, { title: 'x', parentId: 'no_such' });
    expect(created.status).toBe('invalidparent');
  });
});

describe('listNoteTree 격리', () => {
  it('자기 org의 노드만 반환한다', async () => {
    await noteIn(ORG_A, 'A 루트');
    await noteIn(ORG_B, 'B 루트');

    expect((await listNoteTree(ORG_A)).map((n) => n.title)).toEqual(['A 루트']);
    expect((await listNoteTree(ORG_B)).map((n) => n.title)).toEqual(['B 루트']);
  });
});

describe('moveNote — 재배치', () => {
  it('같은 부모 안에서 순서를 바꾼다 (0..n 재작성)', async () => {
    await noteIn(ORG_A, '첫째', null, 0);
    const second = await noteIn(ORG_A, '둘째', null, 1);
    await noteIn(ORG_A, '셋째', null, 2);

    expect(await moveNote(ORG_A, second, { parentId: null, index: 0 }, owner)).toBe('ok');

    expect(await childrenOf(ORG_A, null)).toEqual(['둘째', '첫째', '셋째']);
  });

  it('다른 부모 밑으로 옮기면 대상 그룹의 지정 위치에 들어간다', async () => {
    const root = await noteIn(ORG_A, '루트');
    const child = await noteIn(ORG_A, '자식', root, 0);
    const moved = await noteIn(ORG_A, '이사', null, 1);

    expect(await moveNote(ORG_A, moved, { parentId: root, index: 0 }, owner)).toBe('ok');

    expect(await childrenOf(ORG_A, root)).toEqual(['이사', '자식']);
    expect(await childrenOf(ORG_A, null)).toEqual(['루트']);
    // 기존 자식은 위치만 밀렸다.
    const childRow = await prisma.note.findUniqueOrThrow({ where: { id: child } });
    expect(childRow.position).toBe(1);
  });

  it('이동은 어느 노트의 updatedAt도 밀어 올리지 않는다 (Finding 2 회귀)', async () => {
    // 구조 이동이 '오늘 수정한 문서'로 둔갑하면 안 된다 — 이동 노트 자신도 마찬가지.
    await noteIn(ORG_A, '첫째', null, 0);
    const second = await noteIn(ORG_A, '둘째', null, 1);
    const before = new Map(
      (await prisma.note.findMany({ select: { id: true, updatedAt: true } })).map((row) => [
        row.id,
        row.updatedAt.getTime(),
      ]),
    );

    expect(await moveNote(ORG_A, second, { parentId: null, index: 0 }, owner)).toBe('ok');

    const after = await prisma.note.findMany({ select: { id: true, updatedAt: true } });
    for (const row of after) {
      expect(row.updatedAt.getTime()).toBe(before.get(row.id));
    }
  });

  it('index가 범위를 넘으면 끝으로 클램프된다', async () => {
    await noteIn(ORG_A, '첫째', null, 0);
    const second = await noteIn(ORG_A, '둘째', null, 1);

    expect(await moveNote(ORG_A, second, { parentId: null, index: 999 }, owner)).toBe('ok');
    expect(await childrenOf(ORG_A, null)).toEqual(['첫째', '둘째']);
  });
});

describe('moveNote — 사이클 가드', () => {
  it('자기 자신을 부모로 지정할 수 없다', async () => {
    const root = await noteIn(ORG_A, '루트');
    expect(await moveNote(ORG_A, root, { parentId: root, index: 0 }, owner)).toBe('cycle');
  });

  it('조상 사슬이 검사 상한에 닿으면 이동을 거부한다 (fail-closed)', async () => {
    // d0 ← d1 ← … 로 이어진 1002-깊이 사슬. 상한(1000) 너머의 조상은 검사할 수 없으므로
    // '사이클 아님'을 증명 못 한 이동은 거부돼야 한다 — 통과시키면 d0이 d1001 밑으로
    // 들어가 실제 사이클이 커밋된다(적대적 검증에서 실증된 구멍의 회귀 테스트).
    const DEPTH = 1001;
    await prisma.note.createMany({
      data: Array.from({ length: DEPTH + 1 }, (_, i) => ({
        id: `deep_${i}`,
        orgId: ORG_A,
        authorId: USER_OWNER,
        title: `d${i}`,
        parentId: i === 0 ? null : `deep_${i - 1}`,
        position: 0,
      })),
    });

    expect(await moveNote(ORG_A, 'deep_0', { parentId: `deep_${DEPTH}`, index: 0 }, owner)).toBe(
      'cycle',
    );
    const root = await prisma.note.findUniqueOrThrow({ where: { id: 'deep_0' } });
    expect(root.parentId).toBeNull();
  });

  it('자기 자손 밑으로는 옮길 수 없다', async () => {
    const root = await noteIn(ORG_A, '루트');
    const child = await noteIn(ORG_A, '자식', root);
    const grandchild = await noteIn(ORG_A, '손자', child);

    expect(await moveNote(ORG_A, root, { parentId: grandchild, index: 0 }, owner)).toBe('cycle');

    // 트리가 그대로다 — 루트는 여전히 최상위.
    const rootRow = await prisma.note.findUniqueOrThrow({ where: { id: root } });
    expect(rootRow.parentId).toBeNull();
  });
});

describe('moveNote — 격리·권한', () => {
  it('다른 org에서 호출하면 notfound다', async () => {
    const id = await noteIn(ORG_A, 'A 노트');
    expect(await moveNote(ORG_B, id, { parentId: null, index: 0 }, admin)).toBe('notfound');
  });

  it('다른 org의 노트를 부모로 지정하면 invalidparent다', async () => {
    const id = await noteIn(ORG_A, 'A 노트');
    const rootInB = await noteIn(ORG_B, 'B 루트');

    expect(await moveNote(ORG_A, id, { parentId: rootInB, index: 0 }, owner)).toBe('invalidparent');

    const row = await prisma.note.findUniqueOrThrow({ where: { id } });
    expect(row.parentId).toBeNull();
  });

  it('남의 노트는 이동할 수 없고(forbidden), admin은 할 수 있다', async () => {
    const id = await noteIn(ORG_A, '주인 있는 노트');

    expect(await moveNote(ORG_A, id, { parentId: null, index: 0 }, other)).toBe('forbidden');
    expect(await moveNote(ORG_A, id, { parentId: null, index: 0 }, admin)).toBe('ok');
  });
});

describe('부모 삭제 시 자식 승격 (SetNull)', () => {
  it('부모를 지우면 자식은 루트로 올라오고 내용은 남는다', async () => {
    const root = await noteIn(ORG_A, '루트');
    const child = await noteIn(ORG_A, '자식', root);

    await prisma.note.delete({ where: { id: root } });

    const childRow = await prisma.note.findUniqueOrThrow({ where: { id: child } });
    expect(childRow.parentId).toBeNull();
  });

  it('조직을 지우면 트리 전체가 파기된다 (orgId Cascade)', async () => {
    const root = await noteIn(ORG_A, '루트');
    await noteIn(ORG_A, '자식', root);

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.note.count({ where: { orgId: ORG_A } })).toBe(0);
  });
});
