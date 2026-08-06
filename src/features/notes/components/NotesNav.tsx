'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSelectedLayoutSegment } from 'next/navigation';
import { useOptimistic } from 'react';
import { createNoteAction, moveNoteAction, toggleFavoriteAction } from '@/features/notes/api/actions';
import { applyMove, type TreeMove } from '@/features/notes/tree';
import type { NoteTreeNode, NoteViewer } from '@/features/notes/types';
import { NoteTreePanel } from './NoteTreePanel';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 새 문서의 기본 제목 — 생성 즉시 상세로 이동해 제목부터 고치는 흐름(노션식)이라
// 폼 없이 이 값으로 만든다.
const UNTITLED = '새 문서';

// 노트 셸의 클라이언트 껍데기(KAN-37). 트리는 서버 prop이 원본이고(제목 변경·삭제 등
// 상세 페이지의 변이가 revalidate로 흘러들어온다), 이동·즐겨찾기만 useOptimistic으로
// 트랜지션 동안 먼저 보여준다 — 실패하면 트랜지션 종료와 함께 서버 값으로 자동 복귀
// (보드의 클라이언트 소유 상태와 다른 선택인 이유: 사이드바는 변이 주체가 여럿이라
// 클라이언트가 상태를 소유하면 상세 페이지와 어긋난 채 굳는다).
export function NotesNav({
  nodes,
  favoriteIds,
  viewer,
  children,
}: {
  nodes: NoteTreeNode[];
  favoriteIds: string[];
  viewer: NoteViewer | null;
  children: React.ReactNode;
}) {
  const activeId = useSelectedLayoutSegment();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [optimisticNodes, dispatchMove] = useOptimistic(nodes, applyMove);
  const [optimisticFavorites, dispatchFavorite] = useOptimistic(
    favoriteIds,
    (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]),
  );

  function handleMove(move: TreeMove) {
    setError(null);
    startTransition(async () => {
      dispatchMove(move);
      try {
        const result = await moveNoteAction(move.id, { parentId: move.parentId, index: move.index });
        if (!result.ok) setError(result.error);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function handleToggleFavorite(id: string) {
    setError(null);
    startTransition(async () => {
      dispatchFavorite(id);
      try {
        const result = await toggleFavoriteAction(id);
        if (!result.ok) setError(result.error);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function handleCreate(parentId: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createNoteAction({ title: UNTITLED, parentId });
        if (result.ok) {
          router.push(`/notes/${result.data.id}`);
        } else {
          setError(result.error);
        }
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  const panelProps = {
    nodes: optimisticNodes,
    favoriteIds: optimisticFavorites,
    activeId,
    viewer,
    error,
    onMove: handleMove,
    onToggleFavorite: handleToggleFavorite,
    onCreate: handleCreate,
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r bg-muted/30 md:flex">
        <NoteTreePanel dndId="note-tree-desktop" {...panelProps} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 좁은 화면에선 사이드바 대신 접이식 패널 — 채팅 스트립과 달리 트리는 가로로
            펼 수 없어 세로 패널을 토글한다. */}
        <MobileTreeDisclosure>
          <NoteTreePanel dndId="note-tree-mobile" {...panelProps} />
        </MobileTreeDisclosure>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function MobileTreeDisclosure({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="shrink-0 border-b md:hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        문서 목록
        <span aria-hidden className="text-muted-foreground">
          {open ? '접기' : '펼치기'}
        </span>
      </button>
      {open ? <div className="max-h-72 overflow-y-auto border-t">{children}</div> : null}
    </div>
  );
}
