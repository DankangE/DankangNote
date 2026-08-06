'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { FileText, Plus, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError } from './FormError';
import {
  childrenByParent,
  flattenTree,
  projectDrop,
  subtreeIds,
  type TreeMove,
} from '@/features/notes/tree';
import type { NoteTreeNode, NoteViewer } from '@/features/notes/types';
import { NoteFavoriteRow, NoteTreeRow, TREE_INDENT_PX } from './NoteTreeRow';

// 트리 사이드바 본문(KAN-37) — 즐겨찾기 섹션 + 문서 트리 + 드래그 재배치.
// 드래그 규칙(dnd-kit SortableTree 방식): 세로 위치가 형제 순서, 가로 드래그 거리가
// 중첩 깊이. 드래그 중엔 자손 행을 숨겨 가지째 함께 움직인다.
export function NoteTreePanel({
  dndId,
  nodes,
  favoriteIds,
  activeId,
  viewer,
  error,
  onMove,
  onToggleFavorite,
  onCreate,
}: {
  // DndContext 접근성 id의 시드 — 기본값(전역 카운터)은 SSR과 클라이언트에서 다르게
  // 증가해 hydration mismatch가 난다. 인스턴스(데스크톱/모바일)마다 고정 id를 받는다.
  dndId: string;
  nodes: NoteTreeNode[];
  favoriteIds: string[];
  activeId: string | null;
  viewer: NoteViewer | null;
  error: string | null;
  onMove: (move: TreeMove) => void;
  onToggleFavorite: (id: string) => void;
  onCreate: (parentId: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [depthDelta, setDepthDelta] = useState(0);

  // 8px 이동 전에는 드래그로 치지 않는다 — 행 안의 링크 클릭이 드래그로 오인되지 않게.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const visibleRows = useMemo(() => flattenTree(nodes, collapsed), [nodes, collapsed]);
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  // 드래그 중엔 드래그 노드의 자손을 목록에서 뺀다(가지째 이동). 자신은 남는다 —
  // sortable 자리 계산의 기준점이기 때문.
  const rows = useMemo(() => {
    if (!dragId) return visibleRows;
    const excluded = subtreeIds(nodes, dragId);
    return visibleRows.filter((row) => row.node.id === dragId || !excluded.has(row.node.id));
  }, [visibleRows, nodes, dragId]);

  const projection =
    dragId && overId ? projectDrop(rows, dragId, overId, depthDelta) : null;

  function resetDrag() {
    setDragId(null);
    setOverId(null);
    setDepthDelta(0);
  }

  function handleDragStart(event: DragStartEvent) {
    setDragId(String(event.active.id));
    setOverId(String(event.active.id));
  }

  function handleDragMove(event: DragMoveEvent) {
    setDepthDelta(Math.round(event.delta.x / TREE_INDENT_PX));
  }

  function handleDragOver(event: DragOverEvent) {
    setOverId(event.over ? String(event.over.id) : null);
  }

  function handleDragEnd() {
    if (dragId && projection) {
      const node = nodeById.get(dragId);
      // 제자리 드롭이면 액션을 부르지 않는다 — 이동 노드는 서버가 항상 다시 쓰기 때문.
      const group = node ? (childrenByParent(nodes).get(node.parentId ?? null) ?? []) : [];
      const currentIndex = group.findIndex((sibling) => sibling.id === dragId);
      const unchanged =
        node && projection.parentId === node.parentId && projection.index === currentIndex;
      if (!unchanged) {
        // 접힌 부모 밑으로 드롭하면 즉시 펼친다 — 안 그러면 방금 끌던 행이 화면에서
        // 사라져 이동이 실패한 것처럼 보인다(자체 리뷰 Finding 3).
        const targetParentId = projection.parentId;
        if (targetParentId !== null && collapsed.has(targetParentId)) {
          setCollapsed((prev) => {
            const next = new Set(prev);
            next.delete(targetParentId);
            return next;
          });
        }
        onMove({ id: dragId, parentId: projection.parentId, index: projection.index });
      }
    }
    resetDrag();
  }

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const dragNode = dragId ? nodeById.get(dragId) : null;
  const favorites = favoriteIds
    .map((id) => nodeById.get(id))
    .filter((node): node is NoteTreeNode => node !== undefined);

  return (
    <div className="flex flex-col gap-1 p-2">
      {favorites.length > 0 && (
        <section className="flex flex-col gap-0.5 pb-1">
          <h3 className="px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground">
            즐겨찾기
          </h3>
          {favorites.map((node) => (
            <NoteFavoriteRow
              key={node.id}
              node={node}
              active={node.id === activeId}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </section>
      )}

      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">문서</h3>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label="새 문서"
          onClick={() => onCreate(null)}
        >
          <Plus />
        </Button>
      </div>

      <FormError message={error} />

      {rows.length === 0 ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">
          아직 문서가 없어요. 위의 + 버튼으로 첫 문서를 만들어 보세요.
        </p>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={resetDrag}
        >
          <SortableContext
            items={rows.map((row) => row.node.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-0.5" aria-label="문서 트리">
              {rows.map((row) => (
                <NoteTreeRow
                  key={row.node.id}
                  row={row}
                  active={row.node.id === activeId}
                  favorited={favoriteSet.has(row.node.id)}
                  collapsed={collapsed.has(row.node.id)}
                  // 드래그 중인 행은 투영된 깊이로 들여쓰기해 드롭 결과를 미리 보여준다.
                  depthOverride={row.node.id === dragId && projection ? projection.depth : null}
                  viewer={viewer}
                  onToggleCollapse={toggleCollapsed}
                  onToggleFavorite={onToggleFavorite}
                  onCreateChild={(id) => onCreate(id)}
                />
              ))}
            </ul>
          </SortableContext>

          <DragOverlay>
            {dragNode ? (
              <div className="flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5 text-sm shadow-lg">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{dragNode.title}</span>
                {favoriteSet.has(dragNode.id) && (
                  <Star className="size-3 shrink-0 fill-current text-warning" aria-hidden />
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
