'use client';

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { JSONContent } from '@tiptap/core';
import { Plus, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createNoteAction,
  deleteNoteAction,
  toggleFavoriteAction,
  updateNoteAction,
} from '@/features/notes/api/actions';
import { parseNoteContent, serializeNoteContent } from '@/features/notes/content';
import { authorLabel, noteDateFormat } from '@/features/notes/format';
import type { Note, NoteViewer } from '@/features/notes/types';
import { NoteContent } from './NoteContent';
import { NoteEditor } from './NoteEditor';
import { FormError } from './FormError';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 문서 상세(KAN-37) — NoteCard의 보기/편집 전환을 페이지 단위로 옮긴 것. 낙관적 값은
// useOptimistic이라 저장 트랜지션 동안만 반영되고 실패 시 서버 값으로 자동 복귀한다.
export function NoteDetail({
  note,
  viewer,
  favorited,
}: {
  note: Note;
  viewer: NoteViewer | null;
  favorited: boolean;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [doc, setDoc] = useState<JSONContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [optimisticNote, patchNote] = useOptimistic(
    note,
    (current: Note, patch: Partial<Pick<Note, 'title' | 'content' | 'updatedAt'>>) => ({
      ...current,
      ...patch,
    }),
  );
  const [optimisticFavorited, toggleOptimisticFavorite] = useOptimistic(
    favorited,
    (current: boolean) => !current,
  );

  const viewDoc = useMemo(() => parseNoteContent(optimisticNote.content), [optimisticNote.content]);
  const author = authorLabel(note.author);
  const canModify = viewer ? viewer.isAdmin || note.authorId === viewer.userId : false;

  // 편집 진입 시 최신 값으로 버퍼를 다시 seed한다 — mount 시점 값에 머물면 그 사이
  // 갱신된 노트를 오래된 값으로 덮어쓰는 lost update가 생긴다(NoteCard와 같은 규칙).
  function startEditing() {
    setTitle(note.title);
    setDoc(parseNoteContent(note.content));
    setError(null);
    setIsEditing(true);
  }

  function handleSave() {
    if (isPending || doc === null) return;
    setError(null);
    startTransition(async () => {
      const trimmedTitle = title.trim();
      if (trimmedTitle) {
        patchNote({
          title: trimmedTitle,
          content: serializeNoteContent(doc),
          updatedAt: new Date(),
        });
        setIsEditing(false);
      }
      try {
        const result = await updateNoteAction(note.id, { title, content: doc });
        if (!result.ok) {
          setError(result.error);
          setIsEditing(true);
        }
      } catch {
        setError(GENERIC_ERROR);
        setIsEditing(true);
      }
    });
  }

  function handleDelete() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteNoteAction(note.id);
        if (result.ok) {
          router.push('/notes');
        } else {
          setError(result.error);
          setConfirmingDelete(false);
        }
      } catch {
        setError(GENERIC_ERROR);
        setConfirmingDelete(false);
      }
    });
  }

  function handleToggleFavorite() {
    setError(null);
    startTransition(async () => {
      toggleOptimisticFavorite(undefined);
      try {
        const result = await toggleFavoriteAction(note.id);
        if (!result.ok) setError(result.error);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function handleCreateChild() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await createNoteAction({ title: '새 문서', parentId: note.id });
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        {isEditing ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="note-detail-title">제목</Label>
            <Input
              id="note-detail-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
        ) : (
          <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight break-words">
            {optimisticNote.title}
          </h1>
        )}
        <button
          type="button"
          aria-label={optimisticFavorited ? '즐겨찾기 해제' : '즐겨찾기'}
          aria-pressed={optimisticFavorited}
          className={
            optimisticFavorited
              ? 'rounded-lg p-2 text-warning hover:bg-accent'
              : 'rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground'
          }
          onClick={handleToggleFavorite}
        >
          <Star className={optimisticFavorited ? 'size-5 fill-current' : 'size-5'} aria-hidden />
        </button>
      </div>

      {/* 작성자는 생성자 고정(수정자 아님) — '작성'을 명시해 편집자로 오독되지 않게 한다. */}
      <p className="text-sm text-muted-foreground">
        {author ? `${author} 작성 · ` : ''}
        {noteDateFormat.format(new Date(optimisticNote.updatedAt))} 수정
      </p>

      {isEditing && doc !== null ? (
        <NoteEditor doc={doc} onChange={setDoc} ariaLabel="문서 내용 편집" />
      ) : optimisticNote.content ? (
        <NoteContent doc={viewDoc} />
      ) : (
        <p className="text-sm text-muted-foreground">아직 내용이 없어요.</p>
      )}

      <FormError message={error} />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={isPending} onClick={handleCreateChild}>
          <Plus aria-hidden /> 하위 문서
        </Button>
        <span className="flex-1" />
        {isEditing ? (
          <>
            <Button variant="ghost" disabled={isPending} onClick={() => setIsEditing(false)}>
              취소
            </Button>
            <Button variant="default" disabled={isPending} onClick={handleSave}>
              저장
            </Button>
          </>
        ) : confirmingDelete ? (
          <>
            {/* 하위 문서는 지워지지 않고 최상위로 승격된다(parentId SetNull) — 문구로 고지 */}
            <span className="text-sm text-muted-foreground">
              삭제할까요? 하위 문서는 최상위로 이동합니다.
            </span>
            <Button variant="ghost" disabled={isPending} onClick={() => setConfirmingDelete(false)}>
              취소
            </Button>
            <Button variant="destructive" disabled={isPending} onClick={handleDelete}>
              삭제 확정
            </Button>
          </>
        ) : canModify ? (
          <>
            <Button variant="secondary" onClick={startEditing}>
              편집
            </Button>
            <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
              삭제
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
