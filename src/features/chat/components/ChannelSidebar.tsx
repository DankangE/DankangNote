'use client';

import { useState } from 'react';
import NextLink from 'next/link';
import { Hash, Lock, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { ChannelView } from '@/features/chat/types';
import { CreateChannelForm } from './CreateChannelForm';

// 채팅 전용 2차 내비. 앱 셸의 딥바이올렛 레일 옆에 붙는 밝은 표면이라 셸과 경쟁하지 않는다.
// 활성 채널은 레이아웃 세그먼트로 판정한다 — usePathname 접두사 매칭과 달리 URL 인코딩된
// id에도 정확하다.

// 뱃지에 적는 최대 숫자. 그 이상은 "99+"로 접는다(알림 종과 같은 규칙).
const BADGE_MAX = 99;

function ChannelLink({
  channel,
  active,
  unread,
}: {
  channel: ChannelView;
  active: boolean;
  unread: number;
}) {
  const Icon = channel.isPrivate ? Lock : Hash;
  // 안읽음은 색·굵기와 숫자 두 가지로 표시한다 — 굵기만으로는 몇 건인지 모르고,
  // 숫자만으로는 훑을 때 눈에 안 들어온다.
  const hasUnread = unread > 0 && !active;
  return (
    <NextLink
      href={`/chat/${channel.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-accent font-medium text-accent-foreground'
          : hasUnread
            ? 'font-semibold text-foreground hover:bg-accent/60'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{channel.name}</span>
      {hasUnread && (
        <>
          {/* 스크린리더에는 숫자만으로 뜻이 서지 않는다 — 채널 이름 뒤에 문장으로 붙인다. */}
          <span className="sr-only">{`안읽은 메시지 ${unread}건`}</span>
          <span
            aria-hidden
            className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums"
          >
            {unread > BADGE_MAX ? `${BADGE_MAX}+` : unread}
          </span>
        </>
      )}
    </NextLink>
  );
}

function ChannelGroup({
  title,
  channels,
  activeId,
  unread,
}: {
  title: string;
  channels: ChannelView[];
  activeId: string | null;
  unread: Record<string, number>;
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
        <ChannelLink
          key={channel.id}
          channel={channel}
          active={channel.id === activeId}
          unread={unread[channel.id] ?? 0}
        />
      ))}
    </div>
  );
}

export function ChannelSidebar({
  channels,
  activeId,
  unread,
}: {
  channels: ChannelView[];
  activeId: string | null;
  unread: Record<string, number>;
}) {
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
        <ChannelGroup title="내 채널" channels={mine} activeId={activeId} unread={unread} />
        <ChannelGroup title="둘러보기" channels={browsable} activeId={activeId} unread={unread} />
      </nav>
    </aside>
  );
}

// 모바일용 가로 스크롤 채널 스트립 — 좁은 화면에서 사이드바를 숨기는 대신 이걸 띄운다.
// 참여 중인 채널을 앞에 세워(사이드바의 '내 채널/둘러보기' 구분을 한 줄로 접은 것) 자주
// 쓰는 채널이 스크롤 없이 잡히게 한다. 생성 버튼도 여기 둔다 — 사이드바가 숨는 폭에서
// 채널을 만들 방법이 아예 없어지면 안 된다.
export function ChannelStrip({
  channels,
  activeId,
  unread,
}: {
  channels: ChannelView[];
  activeId: string | null;
  unread: Record<string, number>;
}) {
  const [creating, setCreating] = useState(false);
  const ordered = [
    ...channels.filter((channel) => channel.isMember),
    ...channels.filter((channel) => !channel.isMember),
  ];

  return (
    <div className="shrink-0 border-b md:hidden">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <nav aria-label="채널 목록" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {ordered.map((channel) => (
            <div key={channel.id} className="shrink-0">
              <ChannelLink
                channel={channel}
                active={channel.id === activeId}
                unread={unread[channel.id] ?? 0}
              />
            </div>
          ))}
        </nav>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          aria-label="채널 만들기"
          aria-expanded={creating}
          onClick={() => setCreating((open) => !open)}
        >
          <Plus />
        </Button>
      </div>
      {creating && (
        <div className="px-2 pb-2">
          <CreateChannelForm onClose={() => setCreating(false)} />
        </div>
      )}
    </div>
  );
}
