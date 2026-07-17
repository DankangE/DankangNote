'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { deleteNoteAction, updateNoteAction } from '@/features/notes/api/actions';
import type { Note } from '@/features/notes/types';

export function NoteCard({ note }: { note: Note }) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [error, setError] = useState<string | null>(null);

  // UTC 고정 포맷 — 서버/클라 타임존 차이로 인한 hydration 불일치를 피한다.
  const updatedAt = new Date(note.updatedAt).toISOString().slice(0, 10);

  async function handleSave() {
    setError(null);
    const result = await updateNoteAction(note.id, { title, content });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIsEditing(false);
  }

  async function handleDelete() {
    setError(null);
    const result = await deleteNoteAction(note.id);
    if (!result.ok) {
      setError(result.error);
    }
    // 성공 시 revalidatePath('/notes')로 목록에서 사라진다.
  }

  function handleCancel() {
    setTitle(note.title);
    setContent(note.content);
    setError(null);
    setIsEditing(false);
  }

  return (
    <Card padding={4}>
      <Stack direction="vertical" gap={2}>
        {isEditing ? (
          <>
            <TextInput label="제목" value={title} onChange={setTitle} />
            <TextArea label="내용" value={content} rows={3} onChange={setContent} />
          </>
        ) : (
          <>
            <Heading level={3}>{note.title}</Heading>
            {note.content ? <Text>{note.content}</Text> : null}
            <Text size="sm" color="secondary">
              {updatedAt} 수정
            </Text>
          </>
        )}

        {error ? <Text style={{ color: '#c0453c' }}>{error}</Text> : null}

        <Stack direction="horizontal" gap={2} justify="end">
          {isEditing ? (
            <>
              <Button label="취소" variant="ghost" onClick={handleCancel} />
              <Button label="저장" variant="primary" clickAction={handleSave} />
            </>
          ) : (
            <>
              <Button label="편집" variant="secondary" onClick={() => setIsEditing(true)} />
              <Button label="삭제" variant="destructive" clickAction={handleDelete} />
            </>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
