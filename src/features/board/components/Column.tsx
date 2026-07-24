'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BoardColumnView } from '@/features/board/types';
import { BoardCard } from './BoardCard';
import { AddCardForm } from './AddCardForm';

type ColumnProps = {
  column: BoardColumnView;
  isBusy: boolean;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => void;
  onCreateCard: (columnId: string, text: string) => Promise<boolean>;
  onDeleteCard: (id: string) => void;
};

export function Column({
  column,
  isBusy,
  onRename,
  onDelete,
  onCreateCard,
  onDeleteCard,
}: ColumnProps) {
  // 카드가 없어도 드롭 대상이 되도록 컬럼의 카드 영역 전체를 droppable로 만든다.
  const { setNodeRef } = useDroppable({ id: column.id });
  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function startRename() {
    setName(column.name);
    setIsRenaming(true);
  }

  async function saveRename() {
    const trimmed = name.trim();
    if (!trimmed || isBusy) return;
    const ok = await onRename(column.id, trimmed);
    if (ok) setIsRenaming(false);
  }

  return (
    <div className="flex w-68 shrink-0 flex-col gap-3 rounded-xl border bg-card p-3">
      {isRenaming ? (
        <div className="flex items-center gap-2">
          <Input
            aria-label="컬럼 이름"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveRename();
            }}
          />
          <Button variant="default" size="sm" disabled={isBusy} onClick={saveRename}>
            저장
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsRenaming(false)}>
            취소
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{column.name}</h3>
          {confirmingDelete ? (
            <div className="flex items-center gap-1">
              <Button
                variant="destructive"
                size="sm"
                disabled={isBusy}
                onClick={() => {
                  setConfirmingDelete(false);
                  onDelete(column.id);
                }}
              >
                삭제 확정
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                취소
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={startRename}>
                이름 변경
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
                삭제
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 빈 컬럼도 드롭할 수 있도록 최소 높이를 준다(dnd 드롭 타겟 크기). */}
      <div ref={setNodeRef} className="min-h-8">
        <SortableContext
          items={column.cards.map((card) => card.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-2">
            {column.cards.map((card) => (
              <BoardCard key={card.id} card={card} onDelete={onDeleteCard} />
            ))}
          </div>
        </SortableContext>
      </div>

      <AddCardForm onCreate={(text) => onCreateCard(column.id, text)} isBusy={isBusy} />
    </div>
  );
}
