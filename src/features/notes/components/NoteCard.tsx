'use client';

import { useState, useTransition } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { deleteNoteAction, updateNoteAction } from '@/features/notes/api/actions';
import type { NoteAuthor } from '@/features/notes/types';
import type { NotesAction, OptimisticNote } from '@/features/notes/hooks/useOptimisticNotes';
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
  dispatch: (action: NotesAction) => void;
  onDeleted: (id: string) => void;
};

export function NoteCard({ note, dispatch, onDeleted }: NoteCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  const updatedAt = dateFormat.format(new Date(note.updatedAt));
  const author = authorLabel(note.author);

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

  function handleSave() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      // 유효한 입력이면 저장 즉시 낙관적 값으로 뷰 모드 전환 — revalidated RSC를
      // 기다리는 동안 옛 값이 깜빡이지 않는다. 서버 정렬(updatedAt desc)에 맞춰
      // reducer가 카드를 맨 앞으로 옮긴다.
      const trimmedTitle = title.trim();
      if (trimmedTitle) {
        dispatch({
          type: 'update',
          id: note.id,
          patch: { title: trimmedTitle, content, updatedAt: new Date() },
        });
        setIsEditing(false);
      }
      try {
        const result = await updateNoteAction(note.id, { title, content });
        if (!result.ok) {
          // 낙관적 값은 트랜지션 종료와 함께 자동 롤백된다. 편집 모드로
          // 복귀해 입력 버퍼(title/content)를 보존한다.
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
            {/* 작성자는 생성자 고정(수정자 아님) — '작성'을 명시해 편집자로 오독되지 않게 한다.
                maxLines: 긴 이메일 등 무공백 토큰이 카드 밖으로 넘치지 않게 말줄임. */}
            <Text size="sm" color="secondary" maxLines={1}>
              {author ? `${author} 작성 · ` : ''}
              {updatedAt} 수정
            </Text>
          </>
        )}

        <FormError message={error} />

        <Stack direction="horizontal" gap={2} vAlign="center" justify="end">
          {note.pending ? (
            // 생성 낙관 카드 — 실제 id가 아직 없어 편집·삭제할 수 없다.
            <Text size="sm" color="secondary">
              저장 중…
            </Text>
          ) : isEditing ? (
            <>
              <Button label="취소" variant="ghost" isDisabled={isPending} onClick={cancelEditing} />
              <Button label="저장" variant="primary" isDisabled={isPending} clickAction={handleSave} />
            </>
          ) : confirmingDelete ? (
            <>
              <Text color="secondary">삭제할까요?</Text>
              <Button
                label="취소"
                variant="ghost"
                isDisabled={isPending}
                onClick={() => setConfirmingDelete(false)}
              />
              <Button
                label="삭제 확정"
                variant="destructive"
                isDisabled={isPending}
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
