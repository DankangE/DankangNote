'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { useChannelUnread } from '@/features/chat/use-channel-unread';
import type { ChannelView } from '@/features/chat/types';
import { ChannelSidebar, ChannelStrip } from './ChannelSidebar';

/**
 * 채팅 셸의 클라이언트 껍데기 (KAN-33).
 *
 * 사이드바와 모바일 스트립이 **같은** 안읽음 상태를 봐야 해서 여기서 한 번만 계산한다.
 * 둘이 각자 훅을 부르면 Pusher 커넥션이 둘로 늘고, 한쪽에서 센 증가분이 다른 쪽에 없는
 * 화면이 나온다. children(서버 컴포넌트)은 그대로 통과시킨다.
 */
export function ChannelNav({
  channels,
  viewerId,
  children,
}: {
  channels: ChannelView[];
  viewerId: string;
  children: React.ReactNode;
}) {
  const activeId = useSelectedLayoutSegment();
  const unread = useChannelUnread(channels, activeId, viewerId);

  return (
    <div className="flex h-full min-h-0">
      <ChannelSidebar channels={channels} activeId={activeId} unread={unread} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 좁은 화면에선 사이드바 대신 가로 스트립으로 채널을 옮겨 다닌다. */}
        <ChannelStrip channels={channels} activeId={activeId} unread={unread} />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
