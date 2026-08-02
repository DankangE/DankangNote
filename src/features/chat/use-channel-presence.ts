'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { pingTyping } from '@/features/chat/api/history';
import {
  acquirePusher,
  releasePusher,
  REALTIME_ENABLED,
} from '@/features/chat/pusher-connection';
import { CHAT_TYPING_EVENT, presenceChannel } from '@/features/chat/realtime';
import {
  dropTyping,
  noteTyping,
  presentMember,
  pruneTyping,
  sortMembers,
  withMember,
  withoutMember,
  TYPING_PING_MS,
  type PresentMember,
  type TypingEntry,
} from '@/features/chat/presence';

// 만료된 '입력 중'을 걷어내는 주기. 만료는 시간이 지났다는 사실만으로 일어나므로 이벤트가
// 오지 않아도 화면이 스스로 정리돼야 한다. 아무도 입력하지 않는 동안에는 아예 돌지 않는다.
const PRUNE_INTERVAL_MS = 1_000;

// pusher-js가 프레즌스 이벤트에 싣는 모양. 라이브러리 타입이 느슨해(members: any) 여기서
// 필요한 만큼만 적어 두고, 값이 정말 그런지는 presentMember가 다시 본다.
type PusherMember = { id: unknown; info: unknown } | null;
type PusherMembers = { each: (visit: (member: PusherMember) => void) => void };

/**
 * 채널 프레즌스 · 타이핑 인디케이터 (KAN-34).
 *
 * 소켓은 방이 이미 쓰고 있는 것을 빌린다(pusher-connection) — 프레즌스 때문에 커넥션이
 * 하나 더 늘면 탭 하나가 채팅만으로 소켓 두 개를 쓴다.
 *
 * 반환하는 members는 '지금 이 채널을 열어 둔 사람'이지 참여자 명단이 아니다(명단은 헤더의
 * 참여 N명이다). typing은 만료 시각을 들고 있는 원본이고, 문구는 typingLabel이 만든다.
 */
export function useChannelPresence({
  channelId,
  viewerId,
}: {
  channelId: string;
  viewerId: string;
}): {
  members: readonly PresentMember[];
  typing: readonly TypingEntry[];
  /** 내가 입력 중임을 알린다. 호출은 마음껏 — 안에서 간격을 지킨다. */
  notifyTyping: () => void;
  /** 이 사람의 '입력 중'을 즉시 내린다(그 사람 메시지가 도착했을 때). */
  stopTypingFor: (userId: string) => void;
} {
  const [members, setMembers] = useState<readonly PresentMember[]>([]);
  const [typing, setTyping] = useState<readonly TypingEntry[]>([]);

  const stopTypingFor = useCallback((userId: string) => {
    setTyping((prev) => dropTyping(prev, userId));
  }, []);

  useEffect(() => {
    const client = acquirePusher();
    if (!client) {
      return;
    }
    const name = presenceChannel(channelId);
    const channel = client.subscribe(name);

    // 구독이 성립하면 현재 멤버 전체가 한 번에 온다(이후로는 추가/제거만 온다).
    const onSubscribed = (current: PusherMembers) => {
      const list: PresentMember[] = [];
      current.each((member) => {
        const parsed = presentMember(member?.id, member?.info);
        if (parsed) {
          list.push(parsed);
        }
      });
      setMembers(sortMembers(list));
    };
    const onAdded = (member: PusherMember) => {
      const parsed = presentMember(member?.id, member?.info);
      if (parsed) {
        setMembers((prev) => withMember(prev, parsed));
      }
    };
    const onRemoved = (member: PusherMember) => {
      const id = member?.id;
      if (typeof id !== 'string') {
        return;
      }
      setMembers((prev) => withoutMember(prev, id));
      // 나간 사람의 '입력 중'은 만료를 기다릴 것 없이 같이 내린다.
      setTyping((prev) => dropTyping(prev, id));
    };
    const onTyping = (payload: { userId?: unknown }) => {
      const userId = payload?.userId;
      // 내 핑의 메아리는 버린다 — 브로드캐스트는 보낸 사람에게도 돌아온다.
      if (typeof userId !== 'string' || userId === viewerId) {
        return;
      }
      setTyping((prev) => noteTyping(prev, userId, Date.now()));
    };

    channel.bind('pusher:subscription_succeeded', onSubscribed);
    channel.bind('pusher:member_added', onAdded);
    channel.bind('pusher:member_removed', onRemoved);
    channel.bind(CHAT_TYPING_EVENT, onTyping);
    return () => {
      channel.unbind('pusher:subscription_succeeded', onSubscribed);
      channel.unbind('pusher:member_added', onAdded);
      channel.unbind('pusher:member_removed', onRemoved);
      channel.unbind(CHAT_TYPING_EVENT, onTyping);
      client.unsubscribe(name);
      releasePusher();
      // 구독이 끊긴 뒤에도 남아 있으면 방금 떠난 채널의 접속자가 그대로 보인다.
      setMembers([]);
      setTyping([]);
    };
  }, [channelId, viewerId]);

  // 아무도 입력 중이 아니면 타이머를 걸지 않는다 — 채팅을 열어만 둬도 1초마다 상태가
  // 갱신되면 목록 전체가 계속 다시 그려진다(pruneTyping이 참조를 지키는 것과 같은 이유).
  const idle = typing.length === 0;
  useEffect(() => {
    if (idle) {
      return;
    }
    const timer = setInterval(() => {
      setTyping((prev) => pruneTyping(prev, Date.now()));
    }, PRUNE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [idle]);

  // 마지막으로 핑을 보낸 시각. 글자마다 요청이 나가지 않도록 여기서 간격을 지킨다.
  const lastPing = useRef(0);
  const notifyTyping = useCallback(() => {
    // 실시간이 꺼진 환경에서는 보낼 곳이 없다(서버도 503으로 답한다).
    if (!REALTIME_ENABLED) {
      return;
    }
    const now = Date.now();
    if (now - lastPing.current < TYPING_PING_MS) {
      return;
    }
    lastPing.current = now;
    void pingTyping(channelId);
  }, [channelId]);

  return { members, typing, notifyTyping, stopTypingFor };
}
