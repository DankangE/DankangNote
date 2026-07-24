'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type AddColumnFormProps = {
  onCreate: (name: string) => Promise<boolean>;
  isBusy: boolean;
};

// 보드 끝의 컬럼 추가 입력. 컬럼과 같은 폭(w-68)으로 나란히 놓인다.
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
    <div className="flex w-68 shrink-0 flex-col gap-2 rounded-xl border bg-card p-3">
      <Input
        aria-label="새 컬럼"
        value={name}
        placeholder="컬럼 이름"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          // 한글 IME 조합 확정 Enter는 무시.
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) submit();
        }}
      />
      <Button variant="secondary" size="sm" disabled={isBusy} onClick={submit}>
        컬럼 추가
      </Button>
    </div>
  );
}
