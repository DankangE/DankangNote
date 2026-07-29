'use client';

import { useState } from 'react';
import NextLink from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { Hash, Lock, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { ChannelView } from '@/features/chat/types';
import { CreateChannelForm } from './CreateChannelForm';

// 채팅 전용 2차 내비. 앱 셸의 딥바이올렛 레일 옆에 붙는 밝은 표면이라 셸과 경쟁하지 않는다.
// 활성 채널은 레이아웃 세그먼트로 판정한다 — usePathname 접두사 매칭과 달리 URL 인코딩된
// id에도 정확하다.

function ChannelLink({ channel, active }: { channel: ChannelView; active: boolean }) {
  const Icon = channel.isPrivate ? Lock : Hash;
  return (
    <NextLink
      href={`/chat/${channel.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-accent font-medium text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{channel.name}</span>
    </NextLink>
  );
}

function ChannelGroup({
  title,
  channels,
  activeId,
}: {
  title: string;
  channels: ChannelView[];
  activeId: string | null;
}) {
  if (channels.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <h3 className="px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground">
        {title}
      </h3>
      {channels.map((channel) => (
        <ChannelLink key={channel.id} channel={channel} active={channel.id === activeId} />
      ))}
    </div>
  );
}

export function ChannelSidebar({ channels }: { channels: ChannelView[] }) {
  const activeId = useSelectedLayoutSegment();
  const [creating, setCreating] = useState(false);

  // '내 채널'과 '둘러보기'(참여하지 않은 공개 채널)를 나눈다. 비공개 채널은 참여자에게만
  // 목록에 오므로 항상 '내 채널' 쪽이다.
  const mine = channels.filter((channel) => channel.isMember);
  const browsable = channels.filter((channel) => !channel.isMember);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/30 md:flex">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3">
        <h2 className="text-sm font-semibold tracking-tight">채널</h2>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="채널 만들기"
          aria-expanded={creating}
          onClick={() => setCreating((open) => !open)}
        >
          <Plus />
        </Button>
      </div>

      {creating && (
        <div className="shrink-0 px-3 pt-2">
          <CreateChannelForm onClose={() => setCreating(false)} />
        </div>
      )}

      <nav aria-label="채널 목록" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <ChannelGroup title="내 채널" channels={mine} activeId={activeId} />
        <ChannelGroup title="둘러보기" channels={browsable} activeId={activeId} />
      </nav>
    </aside>
  );
}

// 모바일용 가로 스크롤 채널 스트립 — 좁은 화면에서 사이드바를 숨기는 대신 이걸 띄운다.
export function ChannelStrip({ channels }: { channels: ChannelView[] }) {
  const activeId = useSelectedLayoutSegment();
  return (
    <nav
      aria-label="채널 목록"
      className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5 md:hidden"
    >
      {channels.map((channel) => (
        <div key={channel.id} className="shrink-0">
          <ChannelLink channel={channel} active={channel.id === activeId} />
        </div>
      ))}
    </nav>
  );
}
