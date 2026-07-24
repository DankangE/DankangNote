'use client';

import { useRef, useState } from 'react';
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
  // isBusy는 리렌더 후에야 true가 돼, 빠른 더블클릭이 두 번 제출될 수 있다 — ref로 동기 차단.
  const submitting = useRef(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || isBusy || submitting.current) return;
    submitting.current = true;
    try {
      const ok = await onCreate(trimmed);
      if (ok) setName('');
    } finally {
      submitting.current = false;
    }
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
