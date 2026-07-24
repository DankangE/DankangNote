'use client';

import { useState } from 'react';
import {
  createCardAction,
  createColumnAction,
  deleteCardAction,
  deleteColumnAction,
  moveCardAction,
  renameColumnAction,
} from '@/features/board/api/actions';
import type { BoardView } from '@/features/board/types';
import {
  columnContaining,
  computeMove,
  findCardLocation,
  insertCardAt,
  insertColumnAt,
  removeCard,
} from '@/features/board/dnd';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 보드는 로드 후 클라이언트가 상태를 자체 관리한다(KAN-17). 변이는 낙관적으로 즉시 반영하고
// 액션으로 영속화한다. 실패 시엔 전체 스냅샷이 아니라 해당 항목만 되돌린다 — 그 사이 성공한
// 다른 변이를 덮어쓰지 않도록(자체 리뷰 Finding 2). 크로스세션 실시간은 스코프 밖.
export function useBoardState(initialBoard: BoardView) {
  const [columns, setColumns] = useState<BoardView>(initialBoard);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function createColumn(name: string): Promise<boolean> {
    setIsBusy(true);
    setError(null);
    try {
      const result = await createColumnAction({ name });
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setColumns((prev) => [...prev, result.data]);
      return true;
    } catch {
      setError(GENERIC_ERROR);
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function renameColumn(id: string, name: string): Promise<boolean> {
    const previousName = columns.find((column) => column.id === id)?.name;
    setColumns((prev) => prev.map((column) => (column.id === id ? { ...column, name } : column)));
    setError(null);
    const revert = () => {
      if (previousName !== undefined) {
        setColumns((prev) =>
          prev.map((column) => (column.id === id ? { ...column, name: previousName } : column)),
        );
      }
    };
    try {
      const result = await renameColumnAction({ id, name });
      if (!result.ok) {
        revert();
        setError(result.error);
        return false;
      }
      return true;
    } catch {
      revert();
      setError(GENERIC_ERROR);
      return false;
    }
  }

  async function deleteColumn(id: string): Promise<void> {
    const index = columns.findIndex((column) => column.id === id);
    const removed = index >= 0 ? columns[index] : null;
    setColumns((prev) => prev.filter((column) => column.id !== id));
    setError(null);
    const revert = () => {
      if (removed) setColumns((prev) => insertColumnAt(prev, removed, index));
    };
    try {
      const result = await deleteColumnAction({ id });
      if (!result.ok) {
        revert();
        setError(result.error);
      }
    } catch {
      revert();
      setError(GENERIC_ERROR);
    }
  }

  async function createCard(columnId: string, text: string): Promise<boolean> {
    setIsBusy(true);
    setError(null);
    try {
      const result = await createCardAction({ columnId, text });
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setColumns((prev) =>
        prev.map((column) =>
          column.id === columnId ? { ...column, cards: [...column.cards, result.data] } : column,
        ),
      );
      return true;
    } catch {
      setError(GENERIC_ERROR);
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteCard(id: string): Promise<void> {
    const source = findCardLocation(columns, id);
    setColumns((prev) => removeCard(prev, id));
    setError(null);
    const revert = () => {
      if (source) setColumns((prev) => insertCardAt(prev, source.card, source.columnId, source.index));
    };
    try {
      const result = await deleteCardAction({ id });
      if (!result.ok) {
        revert();
        setError(result.error);
      }
    } catch {
      revert();
      setError(GENERIC_ERROR);
    }
  }

  // 카드 드래그 종료 시 호출. overId는 카드 id 또는 컬럼 id.
  async function moveCard(activeId: string, overId: string): Promise<void> {
    const destColumnId = columnContaining(columns, overId);
    if (!destColumnId) return;
    // 실패 롤백용으로 이동 전 원위치를 잡아둔다(해당 카드만 되돌린다).
    const origin = findCardLocation(columns, activeId);
    const next = computeMove(columns, activeId, overId);
    setColumns(next);
    const orderedCardIds =
      next.find((column) => column.id === destColumnId)?.cards.map((card) => card.id) ?? [];
    setError(null);
    const revert = () => {
      if (origin) {
        setColumns((prev) =>
          insertCardAt(removeCard(prev, activeId), origin.card, origin.columnId, origin.index),
        );
      }
    };
    try {
      const result = await moveCardAction({ cardId: activeId, toColumnId: destColumnId, orderedCardIds });
      if (!result.ok) {
        revert();
        setError(result.error);
      }
    } catch {
      revert();
      setError(GENERIC_ERROR);
    }
  }

  return {
    columns,
    error,
    isBusy,
    createColumn,
    renameColumn,
    deleteColumn,
    createCard,
    deleteCard,
    moveCard,
  };
}
