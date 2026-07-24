'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { TextInput } from '@astryxdesign/core/TextInput';
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
    <Stack direction="vertical" width={272}>
      <Card padding={3}>
        <Stack direction="vertical" gap={3}>
          {isRenaming ? (
            <Stack direction="horizontal" gap={2} vAlign="end">
              <TextInput label="컬럼 이름" value={name} onChange={setName} onEnter={saveRename} />
              <Button label="저장" variant="primary" size="sm" isDisabled={isBusy} clickAction={saveRename} />
              <Button label="취소" variant="ghost" size="sm" onClick={() => setIsRenaming(false)} />
            </Stack>
          ) : (
            <Stack direction="horizontal" gap={2} justify="between" vAlign="center">
              <Heading level={3}>{column.name}</Heading>
              {confirmingDelete ? (
                <Stack direction="horizontal" gap={1} vAlign="center">
                  <Button
                    label="삭제 확정"
                    variant="destructive"
                    size="sm"
                    isDisabled={isBusy}
                    onClick={() => {
                      setConfirmingDelete(false);
                      onDelete(column.id);
                    }}
                  />
                  <Button label="취소" variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)} />
                </Stack>
              ) : (
                <Stack direction="horizontal" gap={1} vAlign="center">
                  <Button label="이름 변경" variant="ghost" size="sm" onClick={startRename} />
                  <Button label="삭제" variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)} />
                </Stack>
              )}
            </Stack>
          )}

          {/* 빈 컬럼도 드롭할 수 있도록 최소 높이를 준다(dnd 드롭 타겟 크기 — 동작용 인라인). */}
          <div ref={setNodeRef} style={{ minHeight: '2rem' }}>
            <SortableContext
              items={column.cards.map((card) => card.id)}
              strategy={verticalListSortingStrategy}
            >
              <Stack direction="vertical" gap={2}>
                {column.cards.map((card) => (
                  <BoardCard key={card.id} card={card} onDelete={onDeleteCard} />
                ))}
              </Stack>
            </SortableContext>
          </div>

          <AddCardForm onCreate={(text) => onCreateCard(column.id, text)} isBusy={isBusy} />
        </Stack>
      </Card>
    </Stack>
  );
}
