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
import { createNote, deleteNote, getNote, listNotes, updateNote } from './notes';

const owner = { userId: USER_OWNER, isAdmin: false };
const other = { userId: USER_OTHER, isAdmin: false };
const admin = { userId: USER_ADMIN, isAdmin: true };

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
});

// A org의 노트 1건을 만들고 id를 돌려준다.
async function noteInA(authorId: string | null = USER_OWNER): Promise<string> {
  const note = await prisma.note.create({
    data: { orgId: ORG_A, authorId, title: 'A의 노트', content: '내용' },
  });
  return note.id;
}

describe('멀티테넌시 격리', () => {
  it('listNotes는 자기 org의 노트만 반환한다', async () => {
    await noteInA();
    await prisma.note.create({ data: { orgId: ORG_B, authorId: USER_OTHER, title: 'B의 노트' } });

    const inA = await listNotes(ORG_A);
    const inB = await listNotes(ORG_B);

    expect(inA.map((n) => n.title)).toEqual(['A의 노트']);
    expect(inB.map((n) => n.title)).toEqual(['B의 노트']);
  });

  it('getNote는 다른 org의 노트를 id로 지정해도 null이다', async () => {
    const id = await noteInA();
    expect(await getNote(ORG_A, id)).not.toBeNull();
    expect(await getNote(ORG_B, id)).toBeNull();
  });

  it('updateNote는 다른 org에서 호출하면 노트를 수정하지 못한다', async () => {
    const id = await noteInA();

    // 남의 워크스페이스 id를 알아도 where의 orgId에 걸려 매칭 자체가 안 된다.
    const result = await updateNote(ORG_B, id, { title: '탈취' }, admin);

    expect(result.status).toBe('notfound');
    const untouched = await prisma.note.findUniqueOrThrow({ where: { id } });
    expect(untouched.title).toBe('A의 노트');
  });

  it('deleteNote는 다른 org에서 호출하면 노트를 지우지 못한다', async () => {
    const id = await noteInA();

    expect(await deleteNote(ORG_B, id, admin)).toBe('notfound');
    expect(await prisma.note.count({ where: { id } })).toBe(1);
  });
});

describe('권한 강제 (KAN-18)', () => {
  it('작성자 본인은 수정·삭제할 수 있다', async () => {
    const id = await noteInA();

    const updated = await updateNote(ORG_A, id, { title: '고침' }, owner);
    expect(updated.status).toBe('ok');
    expect(await deleteNote(ORG_A, id, owner)).toBe('ok');
  });

  it('같은 org의 다른 멤버는 남의 노트를 수정·삭제할 수 없다', async () => {
    const id = await noteInA();

    const updated = await updateNote(ORG_A, id, { title: '남의 수정' }, other);
    expect(updated.status).toBe('forbidden');
    expect(await deleteNote(ORG_A, id, other)).toBe('forbidden');

    const untouched = await prisma.note.findUniqueOrThrow({ where: { id } });
    expect(untouched.title).toBe('A의 노트');
  });

  it('admin은 같은 org의 남의 노트를 수정·삭제할 수 있다', async () => {
    const id = await noteInA();

    const updated = await updateNote(ORG_A, id, { title: 'admin 수정' }, admin);
    expect(updated.status).toBe('ok');
    expect(await deleteNote(ORG_A, id, admin)).toBe('ok');
  });

  it('작성자가 없는(소급 이전) 노트는 admin만 손댈 수 있다', async () => {
    const id = await noteInA(null);

    expect((await updateNote(ORG_A, id, { title: 'x' }, other)).status).toBe('forbidden');
    expect((await updateNote(ORG_A, id, { title: 'admin이 정리' }, admin)).status).toBe('ok');
  });

  it('없는 노트는 forbidden이 아니라 notfound다', async () => {
    expect((await updateNote(ORG_A, 'no_such_note', { title: 'x' }, admin)).status).toBe('notfound');
    expect(await deleteNote(ORG_A, 'no_such_note', admin)).toBe('notfound');
  });
});

describe('createNote tombstone 가드 (KAN-12)', () => {
  it('삭제된 org로는 노트를 만들 수 없고, org 스켈레톤도 부활하지 않는다', async () => {
    await prisma.organization.delete({ where: { id: ORG_A } });
    await prisma.clerkTombstone.create({ data: { id: ORG_A } });

    await expect(createNote(ORG_A, USER_OWNER, { title: '유령 노트' })).rejects.toThrow();

    expect(await prisma.organization.count({ where: { id: ORG_A } })).toBe(0);
    expect(await prisma.note.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('삭제된 사용자로는 노트를 만들 수 없다', async () => {
    await prisma.user.delete({ where: { id: USER_OWNER } });
    await prisma.clerkTombstone.create({ data: { id: USER_OWNER } });

    await expect(createNote(ORG_A, USER_OWNER, { title: '유령 작성자' })).rejects.toThrow();

    expect(await prisma.note.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('미러가 아직 없는 org·작성자도 스켈레톤으로 생성된다 (웹훅 지연 경합)', async () => {
    // 웹훅이 아직 도착하지 않은 상태 — 미러 행이 전혀 없다.
    await prisma.organization.deleteMany({});
    await prisma.user.deleteMany({});

    const created = await createNote(ORG_A, USER_OWNER, { title: '부트스트랩' });

    if (created.status !== 'ok') throw new Error(`생성 실패: ${created.status}`);
    expect(created.note.title).toBe('부트스트랩');
    expect(await prisma.organization.count({ where: { id: ORG_A } })).toBe(1);
    expect(await prisma.user.count({ where: { id: USER_OWNER } })).toBe(1);
  });
});

describe('테넌트 수명 (KAN-14)', () => {
  it('조직을 지우면 그 조직의 노트도 함께 파기된다', async () => {
    await noteInA();
    await prisma.note.create({ data: { orgId: ORG_B, authorId: USER_OTHER, title: 'B 노트' } });

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.note.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.note.count({ where: { orgId: ORG_B } })).toBe(1);
  });

  it('작성자를 지우면 노트는 남고 작성자만 비워진다', async () => {
    const id = await noteInA();

    await prisma.user.delete({ where: { id: USER_OWNER } });

    const note = await prisma.note.findUniqueOrThrow({ where: { id } });
    expect(note.authorId).toBeNull();
  });
});
