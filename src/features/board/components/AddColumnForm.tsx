'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Stack } from '@astryxdesign/core/Stack';
import { TextInput } from '@astryxdesign/core/TextInput';

type AddColumnFormProps = {
  onCreate: (name: string) => Promise<boolean>;
  isBusy: boolean;
};

// 보드 끝의 컬럼 추가 입력. 컬럼과 같은 폭으로 나란히 놓인다.
export function AddColumnForm({ onCreate, isBusy }: AddColumnFormProps) {
  const [name, setName] = useState('');

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || isBusy) return;
    const ok = await onCreate(trimmed);
    if (ok) setName('');
  }

  return (
    <Stack direction="vertical" gap={2} width={272}>
      <Card padding={3}>
        <Stack direction="vertical" gap={2}>
          <TextInput
            label="새 컬럼"
            value={name}
            placeholder="컬럼 이름"
            onChange={setName}
            onEnter={submit}
          />
          <Button
            label="컬럼 추가"
            variant="secondary"
            size="sm"
            isDisabled={isBusy}
            clickAction={submit}
          />
        </Stack>
      </Card>
    </Stack>
  );
}
