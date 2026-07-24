'use client';

import { useState, useTransition } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Stack } from '@astryxdesign/core/Stack';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { JSONContent } from '@tiptap/core';
import { createNoteAction } from '@/features/notes/api/actions';
import { EMPTY_DOC, serializeNoteContent } from '@/features/notes/content';
import type { NotesAction } from '@/features/notes/hooks/useOptimisticNotes';
import { NoteEditor } from './NoteEditor';
import { FormError } from './FormError';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 노트 생성 폼. 본문은 Tiptap 에디터(NoteEditor). 제출 즉시 임시 카드(pending)를 목록에
// 낙관적으로 추가하고 폼을 비운다. 성공하면 revalidated RSC의 실제 노트로 교체되고,
// 실패하면 카드는 자동 롤백되므로 제목 입력을 복원한다.
export function NoteComposer({ dispatch }: { dispatch: (action: NotesAction) => void }) {
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<JSONContent>(EMPTY_DOC);
  // 에디터 content는 마운트 시 seed되므로, 리셋은 key 교체로 리마운트해 비운다.
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetForm() {
    setTitle('');
    setDoc(EMPTY_DOC);
    setEditorKey((key) => key + 1);
  }

  // 실패 시 제목만 되돌린다 — 단, 사용자가 그 사이 새로 타이핑했으면 덮어쓰지 않는다.
  // 본문은 에디터가 이미 리마운트돼 복원 대상이 아니다.
  function restoreTitle(submittedTitle: string) {
    setTitle((current) => (current === '' ? submittedTitle : current));
  }

  function handleCreate() {
    if (isPending) return; // onEnter·버튼 동시 발사로 인한 중복 생성 방지
    setError(null);
    startTransition(async () => {
      // 서버 검증에서 거부될 게 확실한 입력(빈 제목)은 임시 카드를 만들지 않는다 —
      // 나타났다 사라지는 깜빡임 방지. 에러 문구는 서버 검증 결과를 그대로 쓴다.
      const trimmedTitle = title.trim();
      const submittedDoc = doc;
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
        if (optimistic) restoreTitle(title);
      } catch {
        // 액션이 {ok:false} 대신 reject되는 경우(전송 실패 등)도 UI에 표시한다.
        setError(GENERIC_ERROR);
        if (optimistic) restoreTitle(title);
      }
    });
  }

  return (
    <Card padding={4}>
      <Stack direction="vertical" gap={3}>
        <TextInput
          label="제목"
          value={title}
          placeholder="새 노트 제목"
          onChange={setTitle}
          onEnter={handleCreate}
        />
        <NoteEditor key={editorKey} doc={doc} onChange={setDoc} ariaLabel="새 노트 내용" />
        <FormError message={error} />
        <Stack direction="horizontal" justify="end">
          <Button
            label="노트 추가"
            variant="primary"
            isDisabled={isPending}
            clickAction={handleCreate}
          />
        </Stack>
      </Stack>
    </Card>
  );
}
