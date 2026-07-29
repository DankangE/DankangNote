'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { inviteToChannelAction } from '@/features/chat/api/channel-actions';
import type { ChannelPersonView } from '@/features/chat/types';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

function PersonRow({
  person,
  action,
}: {
  person: ChannelPersonView;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      <Avatar className="size-6 shrink-0">
        <AvatarImage src={person.imageUrl ?? undefined} alt="" />
        <AvatarFallback>{person.name.trim().charAt(0).toUpperCase() || '?'}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>
      {action}
    </li>
  );
}

// 비공개 채널의 참여자 확인 + 초대. '지금 누가 이 대화를 볼 수 있나'를 먼저 보여주고,
// 그 아래에 아직 없는 워크스페이스 멤버를 둔다 — 초대는 접근 권한을 주는 일이라
// 현재 명단을 보지 않고 누르게 두면 안 된다.
export function ChannelInvitePanel({
  channelId,
  members,
  candidates,
}: {
  channelId: string;
  members: ChannelPersonView[];
  candidates: ChannelPersonView[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // 여러 명을 잇달아 초대할 수 있으므로 '진행 중'은 집합으로 둔다 — 단일 id로 두면
  // 먼저 누른 쪽의 응답이 나중에 누른 버튼을 도로 활성화한다.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  async function invite(userId: string) {
    if (pending.has(userId)) return;
    setPending((current) => new Set(current).add(userId));
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
      setPending((current) => {
        const next = new Set(current);
        next.delete(userId);
        return next;
      });
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border bg-card p-3">
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-muted-foreground">참여 중</h2>
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {members.map((person) => (
            <PersonRow key={person.id} person={person} />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-muted-foreground">초대할 수 있는 멤버</h2>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            워크스페이스 멤버가 모두 이 채널에 있어요.
          </p>
        ) : (
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {candidates.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending.has(person.id)}
                    onClick={() => invite(person.id)}
                  >
                    초대
                  </Button>
                }
              />
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
