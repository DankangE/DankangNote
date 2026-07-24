'use client';

import type { CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import type { BoardCardView } from '@/features/board/types';

type BoardCardProps = {
  card: BoardCardView;
  onDelete: (id: string) => void;
};

// 드래그 가능한 카드. 카드 전체가 드래그 핸들이고, 삭제 버튼만 pointerDown 전파를 막아
// 클릭이 드래그로 오인되지 않게 한다.
export function BoardCard({ card, onDelete }: BoardCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  // dnd-kit의 프레임별 transform은 동적이라 인라인 style이 유일한 경로다(장식 아닌 동작).
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card padding={3}>
        <Stack direction="horizontal" gap={2} justify="between" vAlign="start">
          <Text>{card.text}</Text>
          <span onPointerDown={(event) => event.stopPropagation()}>
            <Button label="삭제" variant="ghost" size="sm" onClick={() => onDelete(card.id)} />
          </span>
        </Stack>
      </Card>
    </div>
  );
}
