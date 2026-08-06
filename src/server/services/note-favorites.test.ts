import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  ORG_A,
  ORG_B,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedTenants,
} from '../../../test/db';
import { listFavoriteNoteIds, toggleFavorite } from './note-favorites';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
});

async function noteInA(): Promise<string> {
  const note = await prisma.note.create({
    data: { orgId: ORG_A, authorId: USER_OWNER, title: 'A의 노트' },
  });
  return note.id;
}

describe('toggleFavorite (KAN-37)', () => {
  it('없던 즐겨찾기는 켜지고, 다시 누르면 꺼진다', async () => {
    const id = await noteInA();

    expect(await toggleFavorite(ORG_A, USER_OWNER, id)).toEqual({ status: 'ok', favorited: true });
    expect(await listFavoriteNoteIds(ORG_A, USER_OWNER)).toEqual([id]);

    expect(await toggleFavorite(ORG_A, USER_OWNER, id)).toEqual({ status: 'ok', favorited: false });
    expect(await listFavoriteNoteIds(ORG_A, USER_OWNER)).toEqual([]);
  });

  it('사용자별 상태다 — 남의 별과 섞이지 않는다', async () => {
    const id = await noteInA();

    await toggleFavorite(ORG_A, USER_OWNER, id);

    expect(await listFavoriteNoteIds(ORG_A, USER_OWNER)).toEqual([id]);
    expect(await listFavoriteNoteIds(ORG_A, USER_OTHER)).toEqual([]);
  });

  it('다른 org의 노트 id로는 켤 수 없다 (교차 테넌트)', async () => {
    const id = await noteInA();

    expect(await toggleFavorite(ORG_B, USER_OTHER, id)).toEqual({ status: 'notfound' });
    expect(await prisma.noteFavorite.count()).toBe(0);
  });

  it('없는 노트는 notfound다', async () => {
    expect(await toggleFavorite(ORG_A, USER_OWNER, 'no_such')).toEqual({ status: 'notfound' });
  });

  it('삭제된 org·사용자로는 켤 수 없다 (tombstone 가드)', async () => {
    const id = await noteInA();
    await prisma.user.delete({ where: { id: USER_OWNER } });
    await prisma.clerkTombstone.create({ data: { id: USER_OWNER } });

    await expect(toggleFavorite(ORG_A, USER_OWNER, id)).rejects.toThrow();
    expect(await prisma.noteFavorite.count()).toBe(0);
  });
});

describe('수명 정책', () => {
  it('노트를 지우면 그 노트의 즐겨찾기도 파기된다 (Cascade)', async () => {
    const id = await noteInA();
    await toggleFavorite(ORG_A, USER_OWNER, id);

    await prisma.note.delete({ where: { id } });

    expect(await prisma.noteFavorite.count()).toBe(0);
  });

  it('계정을 지우면 그 사용자의 즐겨찾기도 사라진다 (Cascade)', async () => {
    const id = await noteInA();
    await toggleFavorite(ORG_A, USER_OTHER, id);

    await prisma.user.delete({ where: { id: USER_OTHER } });

    expect(await prisma.noteFavorite.count()).toBe(0);
  });

  it('조직을 지우면 그 조직의 즐겨찾기도 파기된다 (orgId Cascade)', async () => {
    const id = await noteInA();
    await toggleFavorite(ORG_A, USER_OWNER, id);

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.noteFavorite.count()).toBe(0);
  });
});
