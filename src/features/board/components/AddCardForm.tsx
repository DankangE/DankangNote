'use client';

import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Stack } from '@astryxdesign/core/Stack';
import { TextInput } from '@astryxdesign/core/TextInput';

type AddCardFormProps = {
  onCreate: (text: string) => Promise<boolean>;
  isBusy: boolean;
};

// 컬럼 하단의 카드 추가 입력. 성공 시에만 입력을 비운다(실패 시 재작성 방지).
export function AddCardForm({ onCreate, isBusy }: AddCardFormProps) {
  const [text, setText] = useState('');
  // isBusy는 리렌더 후에야 true가 돼, 빠른 더블클릭이 두 번 제출될 수 있다 — ref로 동기 차단.
  const submitting = useRef(false);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || isBusy || submitting.current) return;
    submitting.current = true;
    try {
      const ok = await onCreate(trimmed);
      if (ok) setText('');
    } finally {
      submitting.current = false;
    }
  }

  return (
    <Stack direction="vertical" gap={2}>
      <TextInput
        label="새 카드"
        value={text}
        placeholder="카드 내용"
        onChange={setText}
        onEnter={submit}
      />
      <Button label="카드 추가" variant="secondary" size="sm" isDisabled={isBusy} clickAction={submit} />
    </Stack>
  );
}
