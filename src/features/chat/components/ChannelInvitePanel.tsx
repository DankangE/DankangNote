'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { inviteToChannelAction } from '@/features/chat/api/channel-actions';
import type { ChannelPersonView } from '@/features/chat/types';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 비공개 채널에 워크스페이스 멤버를 초대한다. 후보는 서버가 '아직 이 채널에 없는 멤버'로
// 걸러 내려준 목록이라, 초대 후에는 revalidate로 목록에서 사라진다.
export function ChannelInvitePanel({
  channelId,
  candidates,
}: {
  channelId: string;
  candidates: ChannelPersonView[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function invite(userId: string) {
    setPendingId(userId);
    setError(null);
    try {
      const result = await inviteToChannelAction({ id: channelId, userId });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl border bg-card p-3">
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">초대할 수 있는 멤버가 없어요.</p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {candidates.map((person) => (
            <li key={person.id} className="flex items-center gap-2">
              <Avatar className="size-6 shrink-0">
                <AvatarImage src={person.imageUrl ?? undefined} alt="" />
                <AvatarFallback>{person.name.trim().charAt(0).toUpperCase() || '?'}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={pendingId === person.id}
                onClick={() => invite(person.id)}
              >
                초대
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
