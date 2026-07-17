'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Stack } from '@astryxdesign/core/Stack';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { createNoteAction } from '@/features/notes/api/actions';
import { FormError } from './FormError';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 노트 생성 폼. Astryx 입력은 제어형(value 필수)이라 클라이언트 컴포넌트다.
// 성공 시 revalidatePath('/notes')가 서버에서 목록을 다시 렌더한다.
export function NoteComposer() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    if (submitting) return; // onEnter·버튼 동시 발사로 인한 중복 생성 방지
    setSubmitting(true);
    setError(null);
    try {
      const result = await createNoteAction({ title, content });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTitle('');
      setContent('');
    } catch {
      // 액션이 {ok:false} 대신 reject되는 경우(전송 실패 등)도 UI에 표시한다.
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
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
            isDisabled={submitting}
            clickAction={handleCreate}
          />
        </Stack>
      </Stack>
    </Card>
  );
}
