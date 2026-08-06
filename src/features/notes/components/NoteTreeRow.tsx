'use client';

import NextLink from 'next/link';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, FileText, GripVertical, Plus, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TreeRow } from '@/features/notes/tree';
import type { NoteTreeNode, NoteViewer } from '@/features/notes/types';

// 한 칸 들여쓰기 픽셀 — 드래그 가로 거리를 깊이로 환산하는 기준이기도 하다(NoteTreePanel).
export const TREE_INDENT_PX = 16;

// 트리 행 하나. 드래그는 그립 핸들에만 배선한다 — 행 전체에 걸면 터치 스크롤과
// 링크 클릭이 드래그와 계속 다툰다.
export function NoteTreeRow({
  row,
  active,
  favorited,
  collapsed,
  depthOverride,
  viewer,
  onToggleCollapse,
  onToggleFavorite,
  onCreateChild,
}: {
  row: TreeRow;
  active: boolean;
  favorited: boolean;
  collapsed: boolean;
  depthOverride: number | null;
  viewer: NoteViewer | null;
  onToggleCollapse: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onCreateChild: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.node.id,
  });
  const depth = depthOverride ?? row.depth;
  // 이동 권한(작성자/admin)이 없으면 핸들을 숨긴다 — 편의일 뿐, 강제는 서버가 한다(KAN-18).
  const canMove = viewer ? viewer.isAdmin || row.node.authorId === viewer.userId : false;

  return (
    <li
      ref={setNodeRef}
      // dnd-kit의 프레임별 transform과 깊이 들여쓰기는 동적 계산 값이라 인라인이 불가피하다.
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        paddingLeft: depth * TREE_INDENT_PX,
      }}
      className={cn('group/row list-none', isDragging && 'opacity-40')}
    >
      <div
        className={cn(
          'flex items-center gap-0.5 rounded-lg pr-1 text-sm transition-colors',
          active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
        )}
      >
        {canMove ? (
          <button
            type="button"
            aria-label={`${row.node.title} 이동`}
            className="cursor-grab touch-none p-1 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" aria-hidden />
          </button>
        ) : (
          <span className="w-[22px] shrink-0" aria-hidden />
        )}

        {row.hasChildren ? (
          <button
            type="button"
            aria-label={collapsed ? `${row.node.title} 펼치기` : `${row.node.title} 접기`}
            aria-expanded={!collapsed}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent"
            onClick={() => onToggleCollapse(row.node.id)}
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')}
              aria-hidden
            />
          </button>
        ) : (
          <span className="w-[18px] shrink-0" aria-hidden />
        )}

        <NextLink
          href={`/notes/${row.node.id}`}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 py-1.5',
            active ? 'font-medium' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{row.node.title}</span>
        </NextLink>

        <button
          type="button"
          aria-label={favorited ? '즐겨찾기 해제' : '즐겨찾기'}
          aria-pressed={favorited}
          className={cn(
            'rounded p-1 hover:bg-accent',
            favorited
              ? 'text-warning'
              : 'text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
          )}
          onClick={() => onToggleFavorite(row.node.id)}
        >
          <Star className={cn('size-3.5', favorited && 'fill-current')} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`${row.node.title} 아래에 새 문서`}
          className="rounded p-1 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:bg-accent"
          onClick={() => onCreateChild(row.node.id)}
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>
    </li>
  );
}

// 즐겨찾기 섹션의 행 — 트리와 달리 평면이고 드래그가 없다. 별을 누르면 해제된다.
export function NoteFavoriteRow({
  node,
  active,
  onToggleFavorite,
}: {
  node: NoteTreeNode;
  active: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-lg px-1 text-sm transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <NextLink
        href={`/notes/${node.id}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1',
          active ? 'font-medium' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <FileText className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{node.title}</span>
      </NextLink>
      <button
        type="button"
        aria-label="즐겨찾기 해제"
        aria-pressed
        className="rounded p-1 text-warning hover:bg-accent"
        onClick={() => onToggleFavorite(node.id)}
      >
        <Star className="size-3.5 fill-current" aria-hidden />
      </button>
    </div>
  );
}
