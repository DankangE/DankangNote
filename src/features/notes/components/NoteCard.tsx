'use client';

import { useMemo, useState, useTransition } from 'react';
import type { JSONContent } from '@tiptap/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteNoteAction, updateNoteAction } from '@/features/notes/api/actions';
import { EMPTY_DOC, parseNoteContent, serializeNoteContent } from '@/features/notes/content';
import type { NoteAuthor, NoteViewer } from '@/features/notes/types';
import type { NotesAction, OptimisticNote } from '@/features/notes/hooks/useOptimisticNotes';
import { NoteContent } from './NoteContent';
import { NoteEditor } from './NoteEditor';
import { FormError } from './FormError';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 타임존을 명시적으로 고정 — 서버/클라 동일 결과라 hydration이 안전하고,
// UTC 슬라이스와 달리 KST 사용자에게 올바른 날짜를 보여준다.
const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// 작성자 표시명 — 이름이 없으면 이메일, 그것도 없으면(스켈레톤 유저) 표시하지 않는다.
// user_... 원시 id는 사용자에게 무의미해서 fallback으로 쓰지 않는다.
function authorLabel(author: NoteAuthor | null): string | null {
  if (!author) return null;
  return [author.firstName, author.lastName].filter(Boolean).join(' ') || author.email || null;
}

type NoteCardProps = {
  note: OptimisticNote;
  viewer: NoteViewer | null;
  dispatch: (action: NotesAction) => void;
  onDeleted: (id: string) => void;
};

export function NoteCard({ note, viewer, dispatch, onDeleted }: NoteCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [doc, setDoc] = useState<JSONContent>(EMPTY_DOC);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  const updatedAt = dateFormat.format(new Date(note.updatedAt));
  const author = authorLabel(note.author);
  // 뷰 모드 렌더용 doc — 저장 문자열(직렬화 doc 또는 legacy plain)을 파싱한다.
  const viewDoc = useMemo(() => parseNoteContent(note.content), [note.content]);
  // 편집·삭제 버튼 노출 판단(편의). 서버 강제가 본선이라 이 판단이 틀려도 액션이 거부한다.
  // admin은 전체, 그 외엔 본인 노트만. authorId가 null인 소급 이전 노트는 admin만.
  const canModify = viewer ? viewer.isAdmin || note.authorId === viewer.userId : false;

  // 편집 진입 시 최신 prop으로 버퍼를 다시 seed한다. mount 시점 값에 머물면
  // 그 사이 갱신된 노트를 오래된 값으로 덮어쓰는 lost update가 생긴다.
  function startEditing() {
    setTitle(note.title);
    setDoc(parseNoteContent(note.content));
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setError(null);
    setIsEditing(false);
  }

  function handleSave() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      // 유효한 입력이면 저장 즉시 낙관적 값으로 뷰 모드 전환 — revalidated RSC를
      // 기다리는 동안 옛 값이 깜빡이지 않는다.
      const trimmedTitle = title.trim();
      if (trimmedTitle) {
        dispatch({
          type: 'update',
          id: note.id,
          patch: { title: trimmedTitle, content: serializeNoteContent(doc), updatedAt: new Date() },
        });
        setIsEditing(false);
      }
      try {
        const result = await updateNoteAction(note.id, { title, content: doc });
        if (!result.ok) {
          // 낙관적 값은 트랜지션 종료와 함께 자동 롤백된다. 편집 모드로 복귀해 버퍼 보존.
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
      // 카드를 목록에서 즉시 제거. 실패하면 트랜지션 종료 시 자동 복원된다.
      dispatch({ type: 'delete', id: note.id });
      try {
        const result = await deleteNoteAction(note.id);
        if (result.ok) {
          // 서버가 삭제를 확정 — revalidate가 실패해 stale prop이 다시 와도
          // ghost card가 되살아나지 않도록 상위 오버레이에 기록한다.
          onDeleted(note.id);
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

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40">
      {isEditing ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`note-title-${note.id}`}>제목</Label>
            <Input
              id={`note-title-${note.id}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <NoteEditor doc={doc} onChange={setDoc} ariaLabel="노트 내용 편집" />
        </>
      ) : (
        <>
          <h3 className="text-lg font-semibold">{note.title}</h3>
          {note.content ? <NoteContent doc={viewDoc} /> : null}
          {/* 작성자는 생성자 고정(수정자 아님) — '작성'을 명시해 편집자로 오독되지 않게 한다. */}
          <p className="truncate text-sm text-muted-foreground">
            {author ? `${author} 작성 · ` : ''}
            {updatedAt} 수정
          </p>
        </>
      )}

      <FormError message={error} />

      <div className="flex items-center justify-end gap-2">
        {note.pending ? (
          // 생성 낙관 카드 — 실제 id가 아직 없어 편집·삭제할 수 없다.
          <span className="text-sm text-muted-foreground">저장 중…</span>
        ) : isEditing ? (
          <>
            <Button variant="ghost" disabled={isPending} onClick={cancelEditing}>
              취소
            </Button>
            <Button variant="default" disabled={isPending} onClick={handleSave}>
              저장
            </Button>
          </>
        ) : confirmingDelete ? (
          <>
            <span className="text-muted-foreground">삭제할까요?</span>
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
