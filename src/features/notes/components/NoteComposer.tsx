'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { createNoteAction } from '@/features/notes/api/actions';

// 노트 생성 폼. Astryx 입력은 제어형(value 필수)이라 클라이언트 컴포넌트다.
// 성공 시 revalidatePath('/notes')가 서버에서 목록을 다시 렌더한다.
export function NoteComposer() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const result = await createNoteAction({ title, content });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTitle('');
    setContent('');
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
        {error ? <Text style={{ color: '#c0453c' }}>{error}</Text> : null}
        <Stack direction="horizontal" justify="end">
          <Button label="노트 추가" variant="primary" clickAction={handleCreate} />
        </Stack>
      </Stack>
    </Card>
  );
}
