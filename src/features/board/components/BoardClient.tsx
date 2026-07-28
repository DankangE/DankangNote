'use client';

import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { LayoutGrid } from 'lucide-react';
import { EmptyState } from '@/lib/components/EmptyState';
import type { BoardCardView, BoardView } from '@/features/board/types';
import { useBoardState } from '@/features/board/hooks/useBoardState';
import { Column } from './Column';
import { AddColumnForm } from './AddColumnForm';

// 상태·변이는 useBoardState 훅에, 이 컴포넌트는 dnd 배선과 렌더만 담당한다.
export function BoardClient({ initialBoard }: { initialBoard: BoardView }) {
  const { columns, error, isBusy, createColumn, renameColumn, deleteColumn, createCard, deleteCard, moveCard } =
    useBoardState(initialBoard);
  const [activeCard, setActiveCard] = useState<BoardCardView | null>(null);

  const sensors = useSensors(
    // 5px 이동 전에는 드래그로 치지 않는다 — 버튼 클릭이 드래그로 오인되지 않게.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    for (const column of columns) {
      const card = column.cards.find((candidate) => candidate.id === id);
      if (card) {
        setActiveCard(card);
        return;
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return; // 제자리 드롭 — 이동 없음
    void moveCard(activeId, overId);
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <p className="text-sm text-destructive">{`⚠ ${error}`}</p> : null}

      {columns.length === 0 ? (
        <div className="flex flex-col gap-4">
          <EmptyState
            icon={LayoutGrid}
            title="아직 컬럼이 없어요"
            description="첫 컬럼을 추가해 보드를 시작하세요."
          />
          <AddColumnForm onCreate={createColumn} isBusy={isBusy} />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveCard(null)}
        >
          <div className="flex items-start gap-4 overflow-x-auto pb-2">
            {columns.map((column) => (
              <Column
                key={column.id}
                column={column}
                isBusy={isBusy}
                onRename={renameColumn}
                onDelete={deleteColumn}
                onCreateCard={createCard}
                onDeleteCard={deleteCard}
              />
            ))}
            <AddColumnForm onCreate={createColumn} isBusy={isBusy} />
          </div>

          <DragOverlay>
            {activeCard ? (
              <div className="w-68 rounded-lg border bg-card p-3 shadow-lg">
                <p className="text-sm">{activeCard.text}</p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
