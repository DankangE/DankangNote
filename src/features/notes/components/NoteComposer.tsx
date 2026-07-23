'use client';

import { useState, useTransition } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Stack } from '@astryxdesign/core/Stack';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { createNoteAction } from '@/features/notes/api/actions';
import type { NotesAction } from '@/features/notes/hooks/useOptimisticNotes';
import { FormError } from './FormError';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 노트 생성 폼. Astryx 입력은 제어형(value 필수)이라 클라이언트 컴포넌트다.
// 제출 즉시 임시 카드(pending)를 목록에 낙관적으로 추가하고 폼을 비운다.
// 성공하면 revalidated RSC의 실제 노트로 교체되고, 실패하면 카드는 자동
// 롤백되므로 입력을 폼에 복원한다.
export function NoteComposer({ dispatch }: { dispatch: (action: NotesAction) => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 실패 시 제출했던 입력을 폼에 되돌린다 — 단, 사용자가 그 사이 새로 타이핑을
  // 시작했으면(필드가 비어 있지 않으면) 덮어쓰지 않는다.
  function restoreDraft(submittedTitle: string, submittedContent: string) {
    setTitle((current) => (current === '' ? submittedTitle : current));
    setContent((current) => (current === '' ? submittedContent : current));
  }

  function handleCreate() {
    if (isPending) return; // onEnter·버튼 동시 발사로 인한 중복 생성 방지
    setError(null);
    startTransition(async () => {
      // 서버 검증에서 거부될 게 확실한 입력(빈 제목)은 임시 카드를 만들지 않는다 —
      // 나타났다 사라지는 깜빡임 방지. 에러 문구는 서버 검증 결과를 그대로 쓴다.
      const trimmedTitle = title.trim();
      const optimistic = trimmedTitle.length > 0;
      if (optimistic) {
        dispatch({
          type: 'create',
          note: {
            id: `optimistic-${crypto.randomUUID()}`,
            orgId: '', // 화면에 쓰이지 않는 필드 — 서버 확정 시 실제 값으로 교체된다
            // 작성자는 서버 확정 시 채워진다 — 임시 카드는 '저장 중'이라 표시 생략 허용.
            authorId: null,
            author: null,
            title: trimmedTitle,
            content,
            createdAt: new Date(),
            updatedAt: new Date(),
            pending: true,
          },
        });
        setTitle('');
        setContent('');
      }
      try {
        const result = await createNoteAction({ title, content });
        if (result.ok) return;
        setError(result.error);
        if (optimistic) restoreDraft(title, content);
      } catch {
        // 액션이 {ok:false} 대신 reject되는 경우(전송 실패 등)도 UI에 표시한다.
        setError(GENERIC_ERROR);
        if (optimistic) restoreDraft(title, content);
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
        <TextArea
          label="내용"
          value={content}
          placeholder="내용 (선택)"
          rows={3}
          onChange={setContent}
        />
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
