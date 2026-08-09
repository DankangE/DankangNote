'use client';

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { JSONContent } from '@tiptap/core';
import { Plus, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { useCollaborativeDoc } from '@/features/notes/use-collaborative-doc';
import { useNoteAwareness } from '@/features/notes/use-note-awareness';
import { EditorPresence } from './EditorPresence';
import { FormError, FormNotice } from './FormError';
import { NoteComments } from './NoteComments';
import { createCommentThreadAction } from '@/features/notes/api/comment-actions';
import { MAX_COMMENT_BODY, collectCommentThreadIds } from '@/features/notes/comments';
import type { NoteCommentThreadView } from '@/server/services/note-comments';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 문서 상세(KAN-37) — NoteCard의 보기/편집 전환을 페이지 단위로 옮긴 것. 낙관적 값은
// useOptimistic이라 저장 트랜지션 동안만 반영되고 실패 시 서버 값으로 자동 복귀한다.
export function NoteDetail({
  note,
  viewer,
  favorited,
  threads,
}: {
  note: Note;
  viewer: NoteViewer | null;
  favorited: boolean;
  threads: readonly NoteCommentThreadView[];
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [doc, setDoc] = useState<JSONContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 저장은 됐지만 본문이 요청과 달라졌을 때의 안내 (KAN-73 — 죽은 이미지를 떨궜다).
  const [notice, setNotice] = useState<string | null>(null);
  // 열려 있는 코멘트 작성기. resolve는 에디터에게 준 약속을 닫는 손잡이다(startComment 주석).
  const [pendingComment, setPendingComment] = useState<{
    resolve: (threadId: string | null) => void;
  } | null>(null);
  const [commentBody, setCommentBody] = useState('');
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
  // 본문에 앵커가 남아 있는 스레드 (KAN-40). 편집 중에는 아직 저장 안 된 버퍼가 진실이라
  // 그쪽을 본다 — 방금 단 코멘트가 저장 전까지 '위치를 잃음'으로 보이면 안 된다.
  const anchored = useMemo(
    () => new Set(collectCommentThreadIds(isEditing && doc ? doc : viewDoc)),
    [isEditing, doc, viewDoc],
  );

  /**
   * 코멘트 작성기를 열고, 사용자가 확정할 때까지 기다렸다가 **새 스레드의 id**를 돌려준다.
   *
   * 툴바에 약속한 계약이 'Promise<string | null>'인 이유가 여기 있다 — 스레드가 먼저
   * 만들어지고 그 id로 마크가 찍혀야 저장 정규화가 앵커를 걷어 가지 않는다. 작성기가 열려
   * 있는 동안 이 Promise가 미해결로 남고, 확정·취소가 그것을 닫는다.
   */
  function startComment(): Promise<string | null> {
    setCommentBody('');
    setError(null);
    return new Promise((resolve) => setPendingComment({ resolve }));
  }

  function closeComment(threadId: string | null) {
    pendingComment?.resolve(threadId);
    setPendingComment(null);
    setCommentBody('');
  }

  function submitComment() {
    const body = commentBody.trim();
    if (!body || isPending) return;
    startTransition(async () => {
      try {
        const result = await createCommentThreadAction(note.id, body);
        if (result.ok) {
          closeComment(result.data.id);
        } else {
          setError(result.error);
          closeComment(null);
        }
      } catch {
        setError(GENERIC_ERROR);
        closeComment(null);
      }
    });
  }
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
    setNotice(null);
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
        } else if (result.notice) {
          // 편집 모드로 되돌리지 않는다 — 저장은 성공했고, 되돌리면 방금 떨궈진 이미지가
          // 화면에는 아직 남아 있는 버퍼에서 되살아나 같은 안내가 반복된다.
          setNotice(result.notice);
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

      {pendingComment ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <Label htmlFor="note-comment-draft">고른 범위에 코멘트</Label>
          <Textarea
            id="note-comment-draft"
            autoFocus
            rows={2}
            maxLength={MAX_COMMENT_BODY}
            value={commentBody}
            placeholder="무엇이 궁금한가요?"
            onChange={(event) => setCommentBody(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={isPending || commentBody.trim() === ''} onClick={submitComment}>
              코멘트 달기
            </Button>
            <Button variant="ghost" size="sm" disabled={isPending} onClick={() => closeComment(null)}>
              취소
            </Button>
          </div>
        </div>
      ) : null}

      {isEditing && doc !== null ? (
        <CollaborativeBody
          noteId={note.id}
          doc={doc}
          onChange={setDoc}
          onStartComment={startComment}
        />
      ) : optimisticNote.content ? (
        <NoteContent doc={viewDoc} />
      ) : (
        <p className="text-sm text-muted-foreground">아직 내용이 없어요.</p>
      )}

      <FormError message={error} />
      <FormNotice message={notice} />

      <NoteComments threads={threads} anchored={anchored} viewer={viewer} />

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

/**
 * 편집 중에만 공동 편집 연결을 연다 (KAN-39).
 *
 * 별도 컴포넌트인 이유가 둘이다. 훅은 조건부로 부를 수 없고, 무엇보다 **읽기만 하는 사람이
 * 채널을 열 이유가 없다** — 문서를 스크롤만 하는 화면마다 Pusher 구독과 스냅샷 요청이
 * 붙으면 열람이 편집만큼 비싸진다.
 *
 * 연결에 실패하면 협업 없이 편집을 계속하게 둔다(collabDoc = null). 그때는 명시적 저장이
 * 본문을 그대로 저장하므로 편집이 막히지 않는다 — 실시간이 꺼진 로컬 개발과 같은 상태다.
 */
function CollaborativeBody({
  noteId,
  doc,
  onChange,
  onStartComment,
}: {
  noteId: string;
  doc: JSONContent;
  onChange: (next: JSONContent) => void;
  onStartComment: () => Promise<string | null>;
}) {
  const { doc: collabDoc, awareness, status } = useCollaborativeDoc(noteId);

  // 로딩 중에 에디터를 먼저 띄우면 Collaboration이 빈 Y.Doc으로 붙었다가 서버 상태가
  // 도착하며 본문이 겹친다. 잠깐 비워 두는 편이 낫다.
  if (status === 'loading') {
    return <p className="text-sm text-muted-foreground">문서를 여는 중…</p>;
  }
  // 문서 연결이 안 됐으면 커서도 없다 — 훅을 조건부로 부를 수 없어 여기서 갈라 준다.
  if (!collabDoc || !awareness) {
    return (
      <NoteEditor
        doc={doc}
        onChange={onChange}
        ariaLabel="문서 내용 편집"
        onStartComment={onStartComment}
      />
    );
  }
  return (
    <CollaborativeEditor
      noteId={noteId}
      collabDoc={collabDoc}
      awareness={awareness}
      doc={doc}
      onChange={onChange}
      onStartComment={onStartComment}
    />
  );
}

/**
 * 커서·접속자까지 붙은 편집기 (KAN-75). Y.Doc이 확정된 뒤에만 마운트된다 — awareness는
 * 그 문서의 좌표를 들고 다니는 값이라 문서보다 먼저 존재할 이유가 없다.
 */
function CollaborativeEditor({
  noteId,
  collabDoc,
  awareness,
  doc,
  onChange,
  onStartComment,
}: {
  noteId: string;
  collabDoc: Y.Doc;
  awareness: Awareness;
  doc: JSONContent;
  onChange: (next: JSONContent) => void;
  onStartComment: () => Promise<string | null>;
}) {
  const { members, directory } = useNoteAwareness(noteId, awareness);

  return (
    <div className="flex flex-col gap-2">
      <EditorPresence members={members} />
      <NoteEditor
        doc={doc}
        onChange={onChange}
        ariaLabel="문서 내용 편집"
        collabDoc={collabDoc}
        collabAwareness={awareness}
        caretDirectory={directory}
        onStartComment={onStartComment}
      />
    </div>
  );
}
