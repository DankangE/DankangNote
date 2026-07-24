import { arrayMove } from '@dnd-kit/sortable';
import type { BoardColumnView } from '@/features/board/types';

// 카드 이동의 순수 계산 로직(컴포넌트에서 분리). id는 카드 id 또는 컬럼 id일 수 있다.

// id가 속한 컬럼 id를 찾는다 — id 자체가 컬럼이면 그대로, 카드면 그 카드의 컬럼.
export function columnContaining(columns: BoardColumnView[], id: string): string | undefined {
  if (columns.some((column) => column.id === id)) return id;
  return columns.find((column) => column.cards.some((card) => card.id === id))?.id;
}

// activeId 카드를 overId(카드 또는 컬럼) 위치로 옮긴 새 보드를 반환한다.
// 같은 컬럼이면 arrayMove로 재정렬, 다른 컬럼이면 원본에서 빼서 대상에 삽입한다.
export function computeMove(
  columns: BoardColumnView[],
  activeId: string,
  overId: string,
): BoardColumnView[] {
  const from = columnContaining(columns, activeId);
  const to = columnContaining(columns, overId);
  if (!from || !to) return columns;

  if (from === to) {
    return columns.map((column) => {
      if (column.id !== from) return column;
      const oldIndex = column.cards.findIndex((card) => card.id === activeId);
      if (oldIndex < 0) return column;
      const overIndex = column.cards.findIndex((card) => card.id === overId);
      const newIndex = overIndex >= 0 ? overIndex : column.cards.length - 1;
      if (oldIndex === newIndex) return column;
      return { ...column, cards: arrayMove(column.cards, oldIndex, newIndex) };
    });
  }

  const next = columns.map((column) => ({ ...column, cards: [...column.cards] }));
  const source = next.find((column) => column.id === from);
  const dest = next.find((column) => column.id === to);
  if (!source || !dest) return columns;
  const index = source.cards.findIndex((card) => card.id === activeId);
  if (index < 0) return columns;
  const [card] = source.cards.splice(index, 1);
  const overIndex = dest.cards.findIndex((card) => card.id === overId);
  const insertIndex = overIndex >= 0 ? overIndex : dest.cards.length;
  dest.cards.splice(insertIndex, 0, { ...card, columnId: to });
  return next;
}
