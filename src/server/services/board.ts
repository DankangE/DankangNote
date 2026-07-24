import 'server-only';

import { prisma } from '@/server/db';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';

// 보드는 워크스페이스당 1개(Board 모델 없이 orgId 직스코프, KAN-17). 뷰 타입은 화면에
// 필요한 최소 필드만 노출한다(Prisma 행을 그대로 흘리지 않는다).
export interface BoardCardView {
  id: string;
  columnId: string;
  text: string;
  position: number;
  authorId: string | null;
}

export interface BoardColumnView {
  id: string;
  name: string;
  position: number;
  cards: BoardCardView[];
}

export type BoardView = BoardColumnView[];

// 스켈레톤 생성 — webhook이 아직 org/user 미러를 안 채웠어도 FK가 성립하게 한다
// (notes.createNote와 동일 패턴). createMany+skipDuplicates는 네이티브 ON CONFLICT
// DO NOTHING으로 컴파일돼 동시 생성에도 안전하다.
const orgSkeleton = (orgId: string) =>
  prisma.organization.createMany({ data: [{ id: orgId, name: orgId }], skipDuplicates: true });
const userSkeleton = (userId: string) =>
  prisma.user.createMany({ data: [{ id: userId }], skipDuplicates: true });

function toCardView(card: {
  id: string;
  columnId: string;
  text: string;
  position: number;
  authorId: string | null;
}): BoardCardView {
  return {
    id: card.id,
    columnId: card.columnId,
    text: card.text,
    position: card.position,
    authorId: card.authorId,
  };
}

export async function listBoard(orgId: string): Promise<BoardView> {
  const columns = await prisma.boardColumn.findMany({
    where: { orgId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { cards: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
  });
  return columns.map((column) => ({
    id: column.id,
    name: column.name,
    position: column.position,
    cards: column.cards.map(toCardView),
  }));
}

export async function createColumn(orgId: string, name: string): Promise<BoardColumnView> {
  // tombstone 이중 확인 — stale 세션이 삭제된 org를 스켈레톤으로 부활시키지 못하게(KAN-12).
  await assertNotTombstoned([orgId]);
  const position = await prisma.boardColumn.count({ where: { orgId } });
  const [, column] = await prisma.$transaction([
    orgSkeleton(orgId),
    prisma.boardColumn.create({ data: { orgId, name, position } }),
  ]);
  await assertNotTombstoned([orgId], async () => {
    await prisma.boardColumn.deleteMany({ where: { id: column.id } });
  });
  return { id: column.id, name: column.name, position: column.position, cards: [] };
}

// rename/delete/move는 기존 행 대상이라 부활 위험이 없다 — where에 orgId만 실어 타 워크스페이스
// 접근을 쿼리 수준에서 막는다.
export async function renameColumn(orgId: string, id: string, name: string): Promise<boolean> {
  const { count } = await prisma.boardColumn.updateMany({ where: { id, orgId }, data: { name } });
  return count > 0;
}

export async function deleteColumn(orgId: string, id: string): Promise<boolean> {
  // 카드는 columnId Cascade로 함께 삭제된다.
  const { count } = await prisma.boardColumn.deleteMany({ where: { id, orgId } });
  return count > 0;
}

export async function createCard(
  orgId: string,
  authorId: string,
  columnId: string,
  text: string,
): Promise<BoardCardView | null> {
  // 대상 컬럼이 이 org 소유인지 확인 — 타 워크스페이스 컬럼에 카드 삽입 차단.
  const column = await prisma.boardColumn.findFirst({
    where: { id: columnId, orgId },
    select: { id: true },
  });
  if (!column) return null;

  await assertNotTombstoned([orgId, authorId]);
  const position = await prisma.boardCard.count({ where: { columnId, orgId } });
  const [, , card] = await prisma.$transaction([
    orgSkeleton(orgId),
    userSkeleton(authorId),
    prisma.boardCard.create({ data: { orgId, columnId, authorId, text, position } }),
  ]);
  await assertNotTombstoned([orgId, authorId], async () => {
    await prisma.boardCard.deleteMany({ where: { id: card.id } });
  });
  return toCardView(card);
}

export async function deleteCard(orgId: string, id: string): Promise<boolean> {
  const { count } = await prisma.boardCard.deleteMany({ where: { id, orgId } });
  return count > 0;
}

// 카드 이동(같은 컬럼 재정렬 + 컬럼 간 이동). orderedCardIds는 이동 후 대상 컬럼의 최종
// 카드 순서다. 한 트랜잭션으로 그 카드들의 columnId=대상, position=인덱스로 재작성한다.
// 원본 컬럼의 남은 카드는 상대 순서가 유지되므로 건드리지 않는다(position gap은 정렬에 무해).
export async function moveCard(
  orgId: string,
  cardId: string,
  toColumnId: string,
  orderedCardIds: string[],
): Promise<boolean> {
  if (!orderedCardIds.includes(cardId)) return false;

  // 대상 컬럼이 이 org 소유인지 확인.
  const column = await prisma.boardColumn.findFirst({
    where: { id: toColumnId, orgId },
    select: { id: true },
  });
  if (!column) return false;

  // orderedCardIds 전부가 이 org의 카드인지(교차 테넌트·유령 id·중복 차단). 중복이 있으면
  // 고유 행 수가 요청 길이와 달라 거부된다.
  const owned = await prisma.boardCard.findMany({
    where: { id: { in: orderedCardIds }, orgId },
    select: { id: true },
  });
  if (owned.length !== orderedCardIds.length) return false;

  await prisma.$transaction(
    orderedCardIds.map((id, index) =>
      prisma.boardCard.updateMany({
        where: { id, orgId },
        data: { columnId: toColumnId, position: index },
      }),
    ),
  );
  return true;
}
