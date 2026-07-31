'use client';

import { useEffect, useRef, useState } from 'react';
import PusherClient from 'pusher-js';
import { CHAT_MESSAGE_EVENT, chatChannel } from '@/features/chat/realtime';
import type { ChatMessageView, ChannelView } from '@/features/chat/types';

const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

type Counts = Record<string, number>;

function seed(channels: ChannelView[], activeId: string | null): Counts {
  const counts: Counts = {};
  for (const channel of channels) {
    // 보고 있는 채널은 0이다 — ChatRoom이 계속 읽음 처리하고 있어서, 서버가 준 값은
    // 이미 낡았다(그 값을 그대로 두면 열자마자 뱃지가 잠깐 떴다 사라진다).
    counts[channel.id] = channel.id === activeId ? 0 : channel.unread;
  }
  return counts;
}

/**
 * 사이드바 안읽음 수 (KAN-33).
 *
 * 서버가 준 값을 시드로 두고, 실시간 메시지로 올린다. 이미 채널마다 브로드캐스트가 흐르고
 * 있으므로(KAN-28) 내 채널들을 그대로 구독하면 서버에 추가 비용이 전혀 없다 — 대신
 * 클라이언트가 채널 수만큼 인증 요청을 보낸다. 사람 단위 '활동' 이벤트를 따로 쏘는 방법도
 * 있지만, 그건 메시지마다 참여자 수만큼 트리거가 나가는 fan-out이라 더 비싸다.
 *
 * 소켓은 ChatRoom의 것과 별개다. 공유하려면 커넥션을 컨텍스트로 들어올려야 하는데,
 * 그건 채팅 전체의 구조 변경이라 이 티켓의 범위를 넘는다(연결 2개까지는 Pusher의
 * 클라이언트 제한 안이다).
 */
export function useChannelUnread(
  channels: ChannelView[],
  activeId: string | null,
  viewerId: string,
): Counts {
  const [counts, setCounts] = useState<Counts>(() => seed(channels, activeId));

  // 목록이나 활성 채널이 바뀌면 서버 값으로 다시 시드한다. effect가 아니라 렌더 중인 이유는
  // 한 프레임 늦으면 채널을 옮긴 직후 이전 채널의 뱃지가 잠깐 남기 때문이다.
  const [seen, setSeen] = useState({ channels, activeId });
  if (seen.channels !== channels || seen.activeId !== activeId) {
    setSeen({ channels, activeId });
    setCounts(seed(channels, activeId));
  }

  // 구독 대상은 '내 채널' 전부다. 활성 채널까지 포함해 두는 이유는 구독 목록을 이동마다
  // 갈아엎지 않기 위해서고, 활성 채널의 이벤트는 아래에서 무시한다.
  const memberIds = channels
    .filter((channel) => channel.isMember)
    .map((channel) => channel.id)
    .join(',');

  // 구독 핸들러가 재구독 없이 '지금 보고 있는 채널'을 읽게 하는 상자. 렌더에는 쓰지 않고
  // 갱신도 effect에서 한다 — 렌더 중 ref 대입은 동시성 렌더에서 버려질 수 있다.
  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (!PUSHER_KEY || !PUSHER_CLUSTER || memberIds === '') {
      return;
    }
    const ids = memberIds.split(',');
    const client = new PusherClient(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
      channelAuthorization: { transport: 'ajax', endpoint: '/api/pusher/auth' },
    });
    const bound = ids.map((id) => {
      const channel = client.subscribe(chatChannel(id));
      const onMessage = (message: ChatMessageView) => {
        // 안읽음의 정의는 서버(channel-reads.countableWhere)와 같아야 한다 —
        // 답글은 채널 본문에 안 보이고, 내 말은 나에게 안읽음이 아니다.
        if (message.parentId || message.authorId === viewerId) return;
        setCounts((prev) => {
          // 보고 있는 채널은 읽는 중이라 올리지 않는다.
          if (message.channelId === activeIdRef.current) return prev;
          return { ...prev, [message.channelId]: (prev[message.channelId] ?? 0) + 1 };
        });
      };
      channel.bind(CHAT_MESSAGE_EVENT, onMessage);
      return { id, onMessage };
    });
    return () => {
      for (const { id, onMessage } of bound) {
        client.unbind(CHAT_MESSAGE_EVENT, onMessage);
        client.unsubscribe(chatChannel(id));
      }
      client.disconnect();
    };
    // activeId는 의존성에 넣지 않는다 — 채널을 옮길 때마다 전 채널을 재구독하면 이동마다
    // 인증 요청이 채널 수만큼 다시 나간다. 대신 ref로 최신 값을 읽는다.
  }, [memberIds, viewerId, activeIdRef]);

  return counts;
}
