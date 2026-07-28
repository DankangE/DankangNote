import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { ORG_A, ORG_B, USER_OTHER, USER_OWNER, resetDatabase, seedTenants } from '../../../test/db';
import {
  createCard,
  createColumn,
  deleteCard,
  deleteColumn,
  listBoard,
  moveCard,
  renameColumn,
} from './board';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
});

describe('멀티테넌시 격리', () => {
  it('listBoard는 자기 org의 컬럼만 반환한다', async () => {
    await createColumn(ORG_A, '할 일');
    await createColumn(ORG_B, '남의 컬럼');

    expect((await listBoard(ORG_A)).map((c) => c.name)).toEqual(['할 일']);
    expect((await listBoard(ORG_B)).map((c) => c.name)).toEqual(['남의 컬럼']);
  });

  it('다른 org의 컬럼은 이름 변경·삭제가 되지 않는다', async () => {
    const column = await createColumn(ORG_A, '할 일');

    expect(await renameColumn(ORG_B, column.id, '탈취')).toBe(false);
    expect(await deleteColumn(ORG_B, column.id)).toBe(false);

    const still = await prisma.boardColumn.findUniqueOrThrow({ where: { id: column.id } });
    expect(still.name).toBe('할 일');
  });

  it('다른 org의 컬럼에는 카드를 넣을 수 없다', async () => {
    const column = await createColumn(ORG_A, '할 일');

    // B의 세션이 A의 컬럼 id를 알아냈다고 가정한 시나리오.
    expect(await createCard(ORG_B, USER_OTHER, column.id, '침입 카드')).toBeNull();
    expect(await prisma.boardCard.count()).toBe(0);
  });

  it('다른 org의 카드는 삭제되지 않는다', async () => {
    const column = await createColumn(ORG_A, '할 일');
    const card = await createCard(ORG_A, USER_OWNER, column.id, '내 카드');

    expect(await deleteCard(ORG_B, card!.id)).toBe(false);
    expect(await prisma.boardCard.count({ where: { id: card!.id } })).toBe(1);
  });
});

describe('카드 이동 가드 (KAN-17)', () => {
  it('같은 컬럼 안에서 순서를 다시 매긴다', async () => {
    const column = await createColumn(ORG_A, '할 일');
    const first = await createCard(ORG_A, USER_OWNER, column.id, '1');
    const second = await createCard(ORG_A, USER_OWNER, column.id, '2');

    const moved = await moveCard(ORG_A, second!.id, column.id, [second!.id, first!.id]);

    expect(moved).toBe(true);
    const [board] = await listBoard(ORG_A);
    expect(board.cards.map((c) => c.text)).toEqual(['2', '1']);
  });

  it('컬럼 간 이동은 대상 컬럼의 position을 0..n으로 다시 쓴다', async () => {
    const todo = await createColumn(ORG_A, '할 일');
    const done = await createColumn(ORG_A, '완료');
    const card = await createCard(ORG_A, USER_OWNER, todo.id, '옮길 카드');
    const existing = await createCard(ORG_A, USER_OWNER, done.id, '이미 있던 카드');

    const moved = await moveCard(ORG_A, card!.id, done.id, [existing!.id, card!.id]);

    expect(moved).toBe(true);
    const board = await listBoard(ORG_A);
    expect(board.find((c) => c.id === todo.id)!.cards).toHaveLength(0);
    expect(board.find((c) => c.id === done.id)!.cards.map((c) => c.text)).toEqual([
      '이미 있던 카드',
      '옮길 카드',
    ]);
  });

  it('다른 org의 컬럼으로는 옮길 수 없다', async () => {
    const mine = await createColumn(ORG_A, '내 컬럼');
    const theirs = await createColumn(ORG_B, '남의 컬럼');
    const card = await createCard(ORG_A, USER_OWNER, mine.id, '내 카드');

    expect(await moveCard(ORG_A, card!.id, theirs.id, [card!.id])).toBe(false);

    const still = await prisma.boardCard.findUniqueOrThrow({ where: { id: card!.id } });
    expect(still.columnId).toBe(mine.id);
  });

  it('남의 카드 id가 섞인 순서 배열은 통째로 거부한다', async () => {
    const mine = await createColumn(ORG_A, '내 컬럼');
    const theirs = await createColumn(ORG_B, '남의 컬럼');
    const myCard = await createCard(ORG_A, USER_OWNER, mine.id, '내 카드');
    const theirCard = await createCard(ORG_B, USER_OTHER, theirs.id, '남의 카드');

    // 남의 카드를 내 컬럼으로 끌어오려는 시도.
    expect(await moveCard(ORG_A, myCard!.id, mine.id, [myCard!.id, theirCard!.id])).toBe(false);

    const untouched = await prisma.boardCard.findUniqueOrThrow({ where: { id: theirCard!.id } });
    expect(untouched.columnId).toBe(theirs.id);
  });

  it('중복 id가 든 순서 배열은 거부한다', async () => {
    const column = await createColumn(ORG_A, '할 일');
    const card = await createCard(ORG_A, USER_OWNER, column.id, '카드');

    expect(await moveCard(ORG_A, card!.id, column.id, [card!.id, card!.id])).toBe(false);
  });
});

describe('append 위치 계산', () => {
  it('중간 카드를 지워 position에 구멍이 나도 새 카드는 맨 뒤에 붙는다', async () => {
    const column = await createColumn(ORG_A, '할 일');
    const first = await createCard(ORG_A, USER_OWNER, column.id, '1');
    const second = await createCard(ORG_A, USER_OWNER, column.id, '2');
    await createCard(ORG_A, USER_OWNER, column.id, '3');

    await deleteCard(ORG_A, first!.id);
    await deleteCard(ORG_A, second!.id);
    await createCard(ORG_A, USER_OWNER, column.id, '4');

    const [board] = await listBoard(ORG_A);
    expect(board.cards.map((c) => c.text)).toEqual(['3', '4']);
  });
});

describe('테넌트 수명', () => {
  it('조직을 지우면 컬럼·카드가 함께 파기된다', async () => {
    const column = await createColumn(ORG_A, '할 일');
    await createCard(ORG_A, USER_OWNER, column.id, '카드');

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.boardColumn.count()).toBe(0);
    expect(await prisma.boardCard.count()).toBe(0);
  });

  it('컬럼을 지우면 그 안의 카드도 함께 지워진다', async () => {
    const column = await createColumn(ORG_A, '할 일');
    await createCard(ORG_A, USER_OWNER, column.id, '카드');

    await deleteColumn(ORG_A, column.id);

    expect(await prisma.boardCard.count()).toBe(0);
  });

  it('삭제된 org로는 컬럼을 만들 수 없다', async () => {
    await prisma.organization.delete({ where: { id: ORG_A } });
    await prisma.clerkTombstone.create({ data: { id: ORG_A } });

    await expect(createColumn(ORG_A, '유령 컬럼')).rejects.toThrow();
    expect(await prisma.boardColumn.count()).toBe(0);
  });
});
