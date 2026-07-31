'use client';

import { useCallback, useEffect, useState } from 'react';
import PusherClient from 'pusher-js';
import { fetchUnreadCounts } from '@/features/chat/api/history';
import { CHAT_MESSAGE_EVENT, chatChannel } from '@/features/chat/realtime';
import type { ChatMessageView, ChannelView } from '@/features/chat/types';

const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

type Counts = Record<string, number>;

function seed(channels: ChannelView[]): Counts {
  const counts: Counts = {};
  for (const channel of channels) {
    counts[channel.id] = channel.unread;
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
  const [counts, setCounts] = useState<Counts>(() => seed(channels));

  /**
   * **서버 값으로 다시 시드하는 것은 `channels`가 실제로 바뀐 경우뿐이다.**
   *
   * 한때 activeId가 바뀔 때도 통째로 재시드했는데, 그건 다른 채널의 실시간 증가분을
   * 전부 날렸다. 레이아웃은 채널을 옮겨도 다시 돌지 않으므로(Next: "shared layouts won't
   * automatically be refetched on every navigation") `channels`는 같은 객체 그대로고,
   * 그 안의 unread는 페이지를 연 시점의 낡은 값이다 — 재시드는 최신 뱃지를 과거로
   * 되돌리기만 한다. A를 보다가 C로 갈 때 읽지도 않은 B의 뱃지가 사라지는 경로였다.
   */
  const [seenChannels, setSeenChannels] = useState(channels);
  if (seenChannels !== channels) {
    setSeenChannels(channels);
    setCounts(seed(channels));
  }

  /**
   * 채널을 옮기면 **떠난 채널과 새로 연 채널만** 0으로 내린다.
   * 떠난 쪽은 보는 동안 ChatRoom이 읽음 처리를 해 왔고, 새로 연 쪽은 지금부터 읽는다.
   */
  const [seenActive, setSeenActive] = useState(activeId);
  if (seenActive !== activeId) {
    setSeenActive(activeId);
    setCounts((prev) => {
      const next = { ...prev };
      if (seenActive) next[seenActive] = 0;
      if (activeId) next[activeId] = 0;
      return next;
    });
  }

  // 서버 값으로 다시 맞춘다. 실패하면 지금 값을 그대로 둔다 — 뱃지는 부가 정보라
  // 못 맞췄다고 비우는 쪽이 더 나쁘다.
  const resync = useCallback(async () => {
    const fresh = await fetchUnreadCounts();
    if (fresh) setCounts(fresh);
  }, []);

  // 구독 대상은 '내 채널' 전부다. 활성 채널까지 포함해 두는 이유는 구독 목록을 이동마다
  // 갈아엎지 않기 위해서다.
  const memberIds = channels
    .filter((channel) => channel.isMember)
    .map((channel) => channel.id)
    .join(',');

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
        // 보고 있는 채널이어도 그냥 올린다. 여기서 activeId를 보려면 ref가 필요한데,
        // ref는 렌더보다 한 틱 늦어 전환 순간의 이벤트를 엉뚱한 채널 기준으로 판정한다.
        // 대신 보고 있는 채널은 아래 unreadOf가 렌더 시점에 0으로 가리고, 떠날 때
        // 위에서 0으로 내린다 — 판정 시점을 렌더로 미루면 경합 자체가 없다.
        setCounts((prev) => ({
          ...prev,
          [message.channelId]: (prev[message.channelId] ?? 0) + 1,
        }));
      };
      channel.bind(CHAT_MESSAGE_EVENT, onMessage);
      return { id, onMessage };
    });
    // 소켓이 끊긴 사이에 온 메시지는 이 클라이언트에 영영 안 온다 — 다시 붙는 순간
    // 서버 값으로 맞춘다. 첫 connected는 시드가 이미 최신이라 건너뛴다.
    let everConnected = false;
    const onConnected = () => {
      if (everConnected) {
        void resync();
      }
      everConnected = true;
    };
    client.connection.bind('connected', onConnected);

    return () => {
      for (const { id, onMessage } of bound) {
        client.unbind(CHAT_MESSAGE_EVENT, onMessage);
        client.unsubscribe(chatChannel(id));
      }
      client.connection.unbind('connected', onConnected);
      client.disconnect();
    };
    // activeId는 의존성에 없다 — 채널을 옮길 때마다 전 채널을 재구독하면 이동마다
    // 인증 요청이 채널 수만큼 다시 나간다. 활성 채널 판정은 렌더에서 한다(위 주석).
  }, [memberIds, viewerId, resync]);

  // 탭을 오래 두고 온 경우에도 맞춘다 — 브라우저가 백그라운드 소켓을 끊었다 조용히
  // 되살리면 위 connected 훅이 안 걸릴 수 있다.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void resync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [resync]);

  // 보고 있는 채널은 언제나 0으로 보인다 — 읽는 중이니 뱃지가 뜰 이유가 없다.
  return Object.fromEntries(
    Object.entries(counts).map(([id, count]) => [id, id === activeId ? 0 : count]),
  );
}
