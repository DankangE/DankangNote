'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <div className="flex flex-col gap-2">
      <Input
        aria-label="새 카드"
        value={text}
        placeholder="카드 내용"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // 한글 IME 조합 확정 Enter는 무시.
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) submit();
        }}
      />
      <Button variant="secondary" size="sm" disabled={isBusy} onClick={submit}>
        카드 추가
      </Button>
    </div>
  );
}
