'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { createChannelAction } from '@/features/chat/api/channel-actions';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 사이드바에 펼쳐지는 채널 생성 폼. 모달 대신 인라인인 이유는 보드의 컬럼 추가와 같다 —
// 의존성 없이 흐름을 끊지 않는다.
export function CreateChannelForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // isBusy는 리렌더 후에야 반영돼 빠른 더블클릭이 두 번 제출될 수 있다 — ref로 동기 차단.
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await createChannelAction({ name, topic, isPrivate });
      if (result.ok) {
        onClose();
        // 만든 채널로 바로 들어간다. 목록은 액션의 revalidatePath가 갱신한다.
        router.push(`/chat/${result.data.id}`);
      } else {
        setError(result.error);
      }
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-background p-2.5">
      <Input
        autoFocus
        aria-label="채널 이름"
        value={name}
        placeholder="채널 이름 (예: 공지)"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          // 한글 IME 조합 확정 Enter는 무시.
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) submit();
        }}
      />
      <Input
        aria-label="채널 주제"
        value={topic}
        placeholder="주제 (선택)"
        onChange={(event) => setTopic(event.target.value)}
      />
      {/* aria-label을 두지 않는다 — 보이는 글씨가 그대로 접근 가능한 이름이어야 하고
          (WCAG 2.5.3), 눌림 상태는 Toggle의 aria-pressed가 이미 전달한다. */}
      <Toggle variant="outline" size="sm" pressed={isPrivate} onPressedChange={setIsPrivate}>
        <Lock aria-hidden />
        {isPrivate ? '비공개 — 초대한 멤버만' : '공개 — 워크스페이스 전체'}
      </Toggle>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {/* 이름이 비면 제출을 조용히 무시하는 대신 버튼을 잠근다(전송 버튼과 같은 규칙). */}
        <Button size="sm" className="flex-1" disabled={busy || !name.trim()} onClick={submit}>
          만들기
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          취소
        </Button>
      </div>
    </div>
  );
}
