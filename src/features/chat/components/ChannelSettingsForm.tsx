'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateChannelAction } from '@/features/chat/api/channel-actions';
import type { ChannelView } from '@/features/chat/types';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 채널 이름·주제 수정. 기본 채널은 이름이 ensureDefaultChannel의 멱등 키라 잠근다
// (서버도 같은 이유로 거부한다 — 여기서 막는 건 편의).
export function ChannelSettingsForm({
  channel,
  onClose,
}: {
  channel: ChannelView;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function save() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await updateChannelAction({ id: channel.id, name, topic });
      if (result.ok) {
        onClose();
        router.refresh();
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
    <div className="mt-3 flex flex-col gap-2 rounded-xl border bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="채널 이름"
          value={name}
          // disabled가 아니라 readOnly — 잠긴 이유(아래 안내)를 스크린리더가 읽을 수 있게
          // 포커스는 살려 둔다.
          readOnly={channel.isDefault}
          aria-describedby={channel.isDefault ? 'default-channel-note' : undefined}
          placeholder="채널 이름"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            // 한글 IME 조합 확정 Enter는 무시.
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) save();
          }}
        />
        <Input
          aria-label="채널 주제"
          value={topic}
          placeholder="주제 (선택)"
          onChange={(event) => setTopic(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) save();
          }}
        />
      </div>
      {channel.isDefault && (
        <p id="default-channel-note" className="text-xs text-muted-foreground">
          기본 채널은 이름을 바꿀 수 없어요.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={save}>
          저장
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          취소
        </Button>
      </div>
    </div>
  );
}
