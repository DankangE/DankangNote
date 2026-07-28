'use client';

import { useRef, useState, useTransition } from 'react';
import type { JSONContent } from '@tiptap/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createNoteAction } from '@/features/notes/api/actions';
import { EMPTY_DOC, isDocEmpty, serializeNoteContent } from '@/features/notes/content';
import type { NotesAction } from '@/features/notes/hooks/useOptimisticNotes';
import { NoteEditor } from './NoteEditor';
import { FormError } from './FormError';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 노트 생성 폼. 본문은 Tiptap 에디터(NoteEditor). 제출 즉시 임시 카드(pending)를 목록에
// 낙관적으로 추가하고 폼을 비운다. 성공하면 revalidated RSC의 실제 노트로 교체되고,
// 실패하면 카드는 자동 롤백되므로 제목·본문 입력을 복원한다.
export function NoteComposer({ dispatch }: { dispatch: (action: NotesAction) => void }) {
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<JSONContent>(EMPTY_DOC);
  // 에디터 content는 마운트 시 seed되므로, 리셋·복원은 key 교체로 리마운트해 반영한다.
  const [editorKey, setEditorKey] = useState(0);
  // 최신 doc을 트랜지션 클로저·복원 시점에 stale 없이 읽기 위한 참조(state는 async).
  const docRef = useRef<JSONContent>(EMPTY_DOC);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDocChange(next: JSONContent) {
    docRef.current = next;
    setDoc(next);
  }

  function resetForm() {
    setTitle('');
    docRef.current = EMPTY_DOC;
    setDoc(EMPTY_DOC);
    setEditorKey((key) => key + 1);
  }

  // 실패 시 제출했던 입력을 되돌린다 — 단, 사용자가 그 사이 새로 입력한 필드(제목이
  // 비어있지 않거나 본문이 비어있지 않으면)는 덮어쓰지 않는다.
  function restoreDraft(submittedTitle: string, submittedDoc: JSONContent) {
    setTitle((current) => (current === '' ? submittedTitle : current));
    if (isDocEmpty(docRef.current)) {
      docRef.current = submittedDoc;
      setDoc(submittedDoc);
      setEditorKey((key) => key + 1); // 에디터를 제출본으로 리마운트해 본문 복원
    }
  }

  function handleCreate() {
    if (isPending) return; // onEnter·버튼 동시 발사로 인한 중복 생성 방지
    setError(null);
    startTransition(async () => {
      // 서버 검증에서 거부될 게 확실한 입력(빈 제목)은 임시 카드를 만들지 않는다 —
      // 나타났다 사라지는 깜빡임 방지. 에러 문구는 서버 검증 결과를 그대로 쓴다.
      const trimmedTitle = title.trim();
      const submittedDoc = docRef.current;
      const optimistic = trimmedTitle.length > 0;
      if (optimistic) {
        dispatch({
          type: 'create',
          note: {
            id: `optimistic-${crypto.randomUUID()}`,
            orgId: '', // 화면에 쓰이지 않는 필드 — 서버 확정 시 실제 값으로 교체된다
            authorId: null,
            author: null,
            title: trimmedTitle,
            content: serializeNoteContent(submittedDoc),
            createdAt: new Date(),
            updatedAt: new Date(),
            pending: true,
          },
        });
        resetForm();
      }
      try {
        const result = await createNoteAction({ title, content: submittedDoc });
        if (result.ok) return;
        setError(result.error);
        if (optimistic) restoreDraft(title, submittedDoc);
      } catch {
        // 액션이 {ok:false} 대신 reject되는 경우(전송 실패 등)도 UI에 표시한다.
        setError(GENERIC_ERROR);
        if (optimistic) restoreDraft(title, submittedDoc);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note-title">제목</Label>
        <Input
          id="note-title"
          value={title}
          placeholder="새 노트 제목"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            // 한글 IME 조합 확정 Enter는 무시 — 조기 제출·자모 유실 방지.
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleCreate();
          }}
        />
      </div>
      <NoteEditor key={editorKey} doc={doc} onChange={handleDocChange} ariaLabel="새 노트 내용" />
      <FormError message={error} />
      <div className="flex justify-end">
        <Button variant="default" disabled={isPending} onClick={handleCreate}>
          노트 추가
        </Button>
      </div>
    </div>
  );
}
