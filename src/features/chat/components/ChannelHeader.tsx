'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Hash, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/action-result';
import {
  deleteChannelAction,
  joinChannelAction,
  leaveChannelAction,
} from '@/features/chat/api/channel-actions';
import type { ChannelPersonView, ChannelView } from '@/features/chat/types';
import { ChannelInvitePanel } from './ChannelInvitePanel';
import { ChannelSettingsForm } from './ChannelSettingsForm';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

type Panel = 'none' | 'settings' | 'invite';

// 채널 헤더 — 이름·주제와 채널 수준 동작(참여·나가기·설정·삭제·초대)을 모은다.
// 노출 판단은 편의일 뿐이고 강제는 서버가 한다(canManage도 서버가 계산해 내려준 값).
export function ChannelHeader({
  channel,
  members,
  invitable,
}: {
  channel: ChannelView;
  members: ChannelPersonView[];
  invitable: ChannelPersonView[];
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>('none');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // navigateTo가 있으면 이동만 한다 — push 뒤에 refresh까지 하면 착지한 /chat의
  // ensureDefaultChannel 트랜잭션이 두 번 돈다.
  async function run(
    action: Promise<ActionResult<unknown>>,
    navigateTo?: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await action;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (navigateTo) {
        router.push(navigateTo);
        return;
      }
      // 목록·헤더는 서버 컴포넌트가 그린다 — 액션의 revalidate를 화면에 당겨온다.
      router.refresh();
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const Icon = channel.isPrivate ? Lock : Hash;
  const lastPrivateMember = channel.isPrivate && channel.memberCount <= 1;

  return (
    <header className="shrink-0 border-b px-4 py-3 md:px-6">
      <div className="flex items-center gap-3">
        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="leading-tight font-semibold tracking-tight">{channel.name}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {channel.topic ?? (channel.isPrivate ? '초대된 멤버만 볼 수 있어요' : '워크스페이스 전체 공개')}
            {` · 참여 ${channel.memberCount}명`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!channel.isMember && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(joinChannelAction({ id: channel.id }))}
            >
              참여
            </Button>
          )}
          {channel.isPrivate && channel.isMember && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={panel === 'invite'}
              onClick={() => setPanel((current) => (current === 'invite' ? 'none' : 'invite'))}
            >
              멤버 초대
            </Button>
          )}
          {channel.canManage && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={panel === 'settings'}
              onClick={() => setPanel((current) => (current === 'settings' ? 'none' : 'settings'))}
            >
              설정
            </Button>
          )}
          {/* 비공개 채널의 마지막 참여자는 나갈 수 없다(나가면 아무도 못 보는 채널이 된다) —
              서버가 거부하는 조건을 버튼 노출에도 그대로 반영해 눌러보고 알게 하지 않는다. */}
          {channel.isMember && !channel.isDefault && !lastPrivateMember && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              // 비공개 채널은 나가는 순간 안 보이게 되므로 기본 채널로 데리고 나간다.
              // 공개 채널은 나가도 계속 읽을 수 있어 그 자리에 머문다.
              onClick={() =>
                run(leaveChannelAction({ id: channel.id }), channel.isPrivate ? '/chat' : undefined)
              }
            >
              나가기
            </Button>
          )}
          {channel.canManage &&
            !channel.isDefault &&
            (confirmingDelete ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  // 삭제된 채널을 계속 보고 있을 수 없다 — 기본 채널로 돌아간다.
                  onClick={() => run(deleteChannelAction({ id: channel.id }), '/chat')}
                >
                  삭제 확정
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                  취소
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
                삭제
              </Button>
            ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {panel === 'settings' && (
        <ChannelSettingsForm channel={channel} onClose={() => setPanel('none')} />
      )}
      {panel === 'invite' && (
        <ChannelInvitePanel channelId={channel.id} members={members} candidates={invitable} />
      )}
    </header>
  );
}
