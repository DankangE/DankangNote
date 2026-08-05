'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchUnreadCounts } from '@/features/chat/api/history';
import {
  acquirePusher,
  releasePusher,
  subscribeShared,
  unsubscribeShared,
} from '@/features/chat/pusher-connection';
import { CHAT_MESSAGE_EVENT, chatChannel } from '@/features/chat/realtime';
import type { ChatMessageView, ChannelView } from '@/features/chat/types';

type Counts = Record<string, number>;

// 재동기화 트리거를 묶는 창. 구독 성공은 채널 수만큼 따로 오므로 이게 없으면 접속 한 번에
// 그만큼의 요청이 난다.
const RESYNC_COALESCE_MS = 300;

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
 * 소켓은 ChatRoom·프레즌스와 같은 공유 커넥션이다(KAN-56). 활성 채널은 ChatRoom도 같은
 * 이름을 구독하므로 구독·해지가 채널 단위 refcount를 거친다 — pusher-js가 이름당 인증을
 * 한 번만 보내므로 겹침이 곧 인증 절약이고, 해지는 마지막 반납에서만 나간다.
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
    // 새로 연 채널만 0으로 둔다. **떠난 채널을 0으로 단정하면 안 된다** — 위로 올려
    // 이력을 읽는 중이었다면 ChatRoom은 커서를 올리지 않았고(하단에 붙어 있을 때만
    // 올린다), 그 상태로 채널을 옮기면 읽지 않은 것을 읽었다고 표시하게 된다.
    // 진실은 서버만 알기 때문에 아래 effect가 이동마다 다시 물어본다.
    setCounts((prev) => (activeId ? { ...prev, [activeId]: 0 } : prev));
  }

  /**
   * 서버 값으로 다시 맞춘다. 실패하면 지금 값을 그대로 둔다 — 뱃지는 부가 정보라
   * 못 맞췄다고 비우는 쪽이 더 나쁘다.
   *
   * 스냅샷을 통째로 덮어쓰기 때문에 가드가 둘 필요하다.
   * ① **요청 세대** — 탭 전환을 연달아 하면 요청이 여러 개 날고 응답 순서는 보장되지
   *    않는다. 가장 오래된 스냅샷이 마지막에 도착해 이기면 그대로 굳는다.
   * ② **비행 중 증가분** — 응답을 기다리는 사이 도착한 메시지는 서버가 센 시점 이후의
   *    것이라 스냅샷에 없다. 그냥 덮으면 그 메시지는 영영 뱃지에서 빠진다(0인 채널은
   *    응답에 담기지도 않아 키째 사라진다). 따로 모아 두었다가 스냅샷 위에 얹는다.
   */
  const resyncSeq = useRef(0);
  const sinceResync = useRef<Counts>({});
  const runResync = useCallback(async () => {
    const seq = ++resyncSeq.current;
    sinceResync.current = {};
    const fresh = await fetchUnreadCounts();
    if (!fresh || seq !== resyncSeq.current) {
      return;
    }
    const pending = sinceResync.current;
    sinceResync.current = {};
    setCounts(
      Object.keys(pending).reduce<Counts>(
        (acc, id) => ({ ...acc, [id]: (acc[id] ?? 0) + pending[id] }),
        fresh,
      ),
    );
  }, []);

  // 트리거가 여럿이라(구독 성공 N건 · 채널 이동 · 탭 복귀) 그대로 두면 접속 한 번에
  // 채널 수만큼 요청이 동시에 나간다. 짧게 묶어 한 번만 물어본다.
  const coalescing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resync = useCallback(() => {
    if (coalescing.current) return;
    coalescing.current = setTimeout(() => {
      coalescing.current = null;
      void runResync();
    }, RESYNC_COALESCE_MS);
  }, [runResync]);

  useEffect(() => {
    return () => {
      if (coalescing.current) clearTimeout(coalescing.current);
    };
  }, []);

  // 구독 대상은 '내 채널' 전부다. 활성 채널까지 포함해 두는 이유는 구독 목록을 이동마다
  // 갈아엎지 않기 위해서다.
  const memberIds = channels
    .filter((channel) => channel.isMember)
    .map((channel) => channel.id)
    .join(',');

  useEffect(() => {
    if (memberIds === '') {
      return;
    }
    const client = acquirePusher();
    if (!client) {
      return;
    }
    const ids = memberIds.split(',');
    const bound = ids.map((id) => {
      const channel = subscribeShared(client, chatChannel(id));
      const onMessage = (message: ChatMessageView) => {
        // 안읽음의 정의는 서버(channel-reads.unreadCounts의 WHERE)와 같아야 한다 —
        // 답글은 채널 본문에 안 보이고, 내 말은 나에게 안읽음이 아니다.
        if (message.parentId || message.authorId === viewerId) return;
        // 보고 있는 채널이어도 그냥 올린다. 여기서 activeId를 보려면 ref가 필요한데,
        // ref는 렌더보다 한 틱 늦어 전환 순간의 이벤트를 엉뚱한 채널 기준으로 판정한다.
        // 대신 보고 있는 채널은 아래 unreadOf가 렌더 시점에 0으로 가리고, 떠날 때
        // 위에서 0으로 내린다 — 판정 시점을 렌더로 미루면 경합 자체가 없다.
        sinceResync.current[message.channelId] =
          (sinceResync.current[message.channelId] ?? 0) + 1;
        setCounts((prev) => ({
          ...prev,
          [message.channelId]: (prev[message.channelId] ?? 0) + 1,
        }));
      };
      // **구독이 실제로 살아난 뒤에** 서버 값과 맞춘다. connection의 'connected'로는
      // 이르다 — 웹소켓이 붙은 시점이지 채널별 인증이 끝난 시점이 아니라, 그 사이에
      // 발행된 메시지는 스냅샷에도 없고 구독에도 안 잡히는 구멍에 빠진다.
      // 첫 구독도 건너뛰지 않는다: 시드는 RSC 렌더 시각의 값이라 하이드레이션·인증을
      // 거치는 동안 온 메시지가 이미 빠져 있다.
      const onSubscribed = () => resync();
      channel.bind(CHAT_MESSAGE_EVENT, onMessage);
      channel.bind('pusher:subscription_succeeded', onSubscribed);
      // 공유 소켓에서는 다른 쪽(ChatRoom)이 먼저 구독을 끝냈을 수 있다(KAN-56) — 그러면
      // succeeded는 이미 지나간 이벤트라 위 bind에 안 걸리고, 이 채널의 초기 재동기가
      // 통째로 빠진다. 이미 살아 있는 구독에 합류한 경우엔 지금 맞춘다.
      if (channel.subscribed) {
        resync();
      }
      return { channel, onMessage, onSubscribed };
    });
    return () => {
      for (const { channel, onMessage, onSubscribed } of bound) {
        channel.unbind(CHAT_MESSAGE_EVENT, onMessage);
        channel.unbind('pusher:subscription_succeeded', onSubscribed);
        unsubscribeShared(client, channel.name);
      }
      releasePusher();
    };
    // activeId는 의존성에 없다 — 채널을 옮길 때마다 전 채널을 재구독하면 이동마다
    // 인증 요청이 채널 수만큼 다시 나간다. 활성 채널 판정은 렌더에서 한다(위 주석).
  }, [memberIds, viewerId, resync]);

  // 채널을 옮길 때마다 맞춘다 — 레이아웃은 이동만으로 다시 돌지 않으므로 이게 떠난
  // 채널의 진짜 안읽음을 알 수 있는 유일한 경로다.
  useEffect(() => {
    resync();
  }, [activeId, resync]);

  // 탭을 오래 두고 온 경우에도 맞춘다 — 브라우저가 백그라운드 소켓을 끊었다 조용히
  // 되살리면 위 connected 훅이 안 걸릴 수 있다.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') resync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [resync]);

  // 보고 있는 채널은 언제나 0으로 보인다 — 읽는 중이니 뱃지가 뜰 이유가 없다.
  return Object.fromEntries(
    Object.entries(counts).map(([id, count]) => [id, id === activeId ? 0 : count]),
  );
}
