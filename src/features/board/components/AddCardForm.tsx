'use client';

import { useState } from 'react';
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

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    const ok = await onCreate(trimmed);
    if (ok) setText('');
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
