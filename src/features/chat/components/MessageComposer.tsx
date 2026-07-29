'use client';

import { useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// 슬랙식 컴포저 — 테두리 박스 안에 무테 Textarea + 아이콘 전송 버튼.
// 채널 본문과 스레드 패널이 함께 쓴다(KAN-30).
//
// 초안을 여기서 들고 있는 대신 onSend가 성공 여부를 돌려준다: 실패하면 방금 보낸 본문을
// 되돌려 놔야 하는데, 그 복원은 초안을 소유한 쪽만 정확히 할 수 있다.
export function MessageComposer({
  label,
  placeholder,
  disabled,
  onSend,
}: {
  label: string;
  placeholder: string;
  disabled?: boolean;
  onSend: (body: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState('');

  async function submit() {
    const body = draft.trim();
    if (!body) {
      return;
    }
    setDraft('');
    const ok = await onSend(body);
    // 그 사이 새로 입력 중이면 사용자의 글을 덮지 않는다.
    if (!ok) {
      setDraft((current) => (current === '' ? body : current));
    }
  }

  return (
    <div className="flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <Textarea
        aria-label={label}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        className="max-h-32 min-h-8 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter=전송, Shift+Enter=줄바꿈. 한글 IME 조합 확정 Enter는 무시.
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {/* 데스크톱에서는 본문과 스레드의 컴포저가 동시에 떠 있다 — 두 전송 버튼의 접근
          가능한 이름이 같으면 스크린리더에서 구분되지 않으므로 label을 함께 싣는다. */}
      <Button
        size="icon"
        aria-label={`${label} 보내기`}
        disabled={disabled || draft.trim().length === 0}
        onClick={submit}
      >
        <SendHorizontal />
      </Button>
    </div>
  );
}
