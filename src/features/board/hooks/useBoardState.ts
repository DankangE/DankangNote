'use client';

import { useState } from 'react';
import {
  createCardAction,
  createColumnAction,
  deleteCardAction,
  deleteColumnAction,
  moveCardAction,
  refreshBoardAction,
  renameColumnAction,
} from '@/features/board/api/actions';
import type { BoardView } from '@/features/board/types';
import { columnContaining, computeMove } from '@/features/board/dnd';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 보드는 로드 후 클라이언트가 상태를 자체 관리한다(KAN-17). 변이는 낙관적으로 즉시 반영하고
// 액션으로 영속화한다. 크로스세션 실시간은 스코프 밖.
export function useBoardState(initialBoard: BoardView) {
  const [columns, setColumns] = useState<BoardView>(initialBoard);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // 낙관적 변이 실패 시 서버 진실로 되돌린다. 전체 스냅샷을 그대로 복원하면 그 사이 성공한
  // 다른 변이를 덮어쓰므로(자체 리뷰 Finding 2), 재조회로 재동기화하고 재조회가 실패할
  // 때만 스냅샷으로 폴백한다.
  async function resync(fallback: BoardView): Promise<void> {
    const result = await refreshBoardAction();
    setColumns(result.ok ? result.data : fallback);
  }

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
    const snapshot = columns;
    setColumns((prev) => prev.map((column) => (column.id === id ? { ...column, name } : column)));
    setError(null);
    try {
      const result = await renameColumnAction({ id, name });
      if (!result.ok) {
        await resync(snapshot);
        setError(result.error);
        return false;
      }
      return true;
    } catch {
      await resync(snapshot);
      setError(GENERIC_ERROR);
      return false;
    }
  }

  async function deleteColumn(id: string): Promise<void> {
    const snapshot = columns;
    setColumns((prev) => prev.filter((column) => column.id !== id));
    setError(null);
    try {
      const result = await deleteColumnAction({ id });
      if (!result.ok) {
        await resync(snapshot);
        setError(result.error);
      }
    } catch {
      await resync(snapshot);
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
    const snapshot = columns;
    setColumns((prev) =>
      prev.map((column) => ({ ...column, cards: column.cards.filter((card) => card.id !== id) })),
    );
    setError(null);
    try {
      const result = await deleteCardAction({ id });
      if (!result.ok) {
        await resync(snapshot);
        setError(result.error);
      }
    } catch {
      await resync(snapshot);
      setError(GENERIC_ERROR);
    }
  }

  // 카드 드래그 종료 시 호출. overId는 카드 id 또는 컬럼 id.
  async function moveCard(activeId: string, overId: string): Promise<void> {
    const destColumnId = columnContaining(columns, overId);
    if (!destColumnId) return;
    const snapshot = columns;
    const next = computeMove(columns, activeId, overId);
    setColumns(next);
    const orderedCardIds =
      next.find((column) => column.id === destColumnId)?.cards.map((card) => card.id) ?? [];
    setError(null);
    try {
      const result = await moveCardAction({ cardId: activeId, toColumnId: destColumnId, orderedCardIds });
      if (!result.ok) {
        await resync(snapshot);
        setError(result.error);
      }
    } catch {
      await resync(snapshot);
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
