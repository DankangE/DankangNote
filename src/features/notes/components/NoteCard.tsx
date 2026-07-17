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

export function NoteCard({ note }: { note: Note }) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const updatedAt = dateFormat.format(new Date(note.updatedAt));

  // 편집 진입 시 최신 prop으로 버퍼를 다시 seed한다. mount 시점 값에 머물면
  // 그 사이 갱신된 노트를 오래된 값으로 덮어쓰는 lost update가 생긴다.
  // 이전 액션의 에러도 함께 리셋한다.
  function startEditing() {
    setTitle(note.title);
    setContent(note.content);
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setError(null);
    setIsEditing(false);
  }

  async function handleSave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await updateNoteAction(note.id, { title, content });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIsEditing(false);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteNoteAction(note.id);
      if (!result.ok) {
        setError(result.error);
        setConfirmingDelete(false);
      }
      // 성공 시 revalidatePath('/notes')로 목록에서 사라진다.
    } catch {
      setError(GENERIC_ERROR);
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
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

        <FormError message={error} />

        <Stack direction="horizontal" gap={2} vAlign="center" justify="end">
          {isEditing ? (
            <>
              <Button label="취소" variant="ghost" isDisabled={busy} onClick={cancelEditing} />
              <Button label="저장" variant="primary" isDisabled={busy} clickAction={handleSave} />
            </>
          ) : confirmingDelete ? (
            <>
              <Text color="secondary">삭제할까요?</Text>
              <Button
                label="취소"
                variant="ghost"
                isDisabled={busy}
                onClick={() => setConfirmingDelete(false)}
              />
              <Button
                label="삭제 확정"
                variant="destructive"
                isDisabled={busy}
                clickAction={handleDelete}
              />
            </>
          ) : (
            <>
              <Button label="편집" variant="secondary" onClick={startEditing} />
              <Button label="삭제" variant="destructive" onClick={() => setConfirmingDelete(true)} />
            </>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
