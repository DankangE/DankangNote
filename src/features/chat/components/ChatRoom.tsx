'use client';

import { useEffect, useState } from 'react';
import PusherClient from 'pusher-js';
import { Avatar } from '@astryxdesign/core/Avatar';
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
} from '@astryxdesign/core/Chat';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { sendMessageAction } from '@/features/chat/api/actions';
import { CHAT_MESSAGE_EVENT, orgChannel } from '@/features/chat/realtime';
import type { ChatMessageView, ChatViewer } from '@/features/chat/types';

// NEXT_PUBLIC_*은 빌드 시 인라인된다 — 없으면 실시간 구독 없이 동작(경고 표시).
const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
const REALTIME_OFF_NOTICE =
  '실시간 연결이 설정되지 않았어요. 다른 멤버의 새 메시지는 새로고침해야 보입니다.';

// 타임존 고정 — 서버/클라 동일 결과라 hydration이 안전하다 (NoteCard와 같은 이유).
const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
});

type RoomMessage = ChatMessageView & { pending?: boolean };

// 이미 있는 id(자기 전송의 브로드캐스트 echo)는 버리고,
// replaceId가 있으면 낙관 임시 항목을 서버 확정본으로 교체한다.
function upsert(list: RoomMessage[], incoming: RoomMessage, replaceId?: string): RoomMessage[] {
  const rest = replaceId ? list.filter((message) => message.id !== replaceId) : list;
  if (rest.some((message) => message.id === incoming.id)) {
    return rest;
  }
  return [...rest, incoming];
}

export function ChatRoom({
  initialMessages,
  viewer,
  orgId,
}: {
  initialMessages: ChatMessageView[];
  viewer: ChatViewer;
  orgId: string;
}) {
  // 서버가 준 초기 목록을 시드로, 이후엔 Pusher 이벤트·전송 결과로만 갱신하는
  // 라이브 스트림 상태. 서버 상태의 사본이 아니라 이벤트 소싱 뷰라 useState가 맞다.
  const [messages, setMessages] = useState<RoomMessage[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!PUSHER_KEY || !PUSHER_CLUSTER) {
      return;
    }
    const client = new PusherClient(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
      channelAuthorization: { transport: 'ajax', endpoint: '/api/pusher/auth' },
    });
    const channel = client.subscribe(orgChannel(orgId));
    const onMessage = (message: ChatMessageView) => {
      setMessages((prev) => upsert(prev, message));
    };
    channel.bind(CHAT_MESSAGE_EVENT, onMessage);
    return () => {
      channel.unbind(CHAT_MESSAGE_EVENT, onMessage);
      client.unsubscribe(orgChannel(orgId));
      client.disconnect();
    };
  }, [orgId]);

  // 실패한 낙관 말풍선은 제거하고, 그 사이 새로 입력 중이 아니면 본문을 복원한다.
  function failSend(tempId: string, message: string, body: string) {
    setMessages((prev) => prev.filter((m) => m.id !== tempId));
    setError(message);
    setDraft((current) => (current === '' ? body : current));
  }

  async function handleSubmit(value: string) {
    const body = value.trim();
    if (!body) {
      return;
    }
    setError(null);
    setDraft('');

    // 낙관 전송 — 즉시 내 말풍선을 붙이고, 성공 시 서버 확정본으로 교체한다.
    // 연속 전송은 각자 tempId를 가져 서로 간섭하지 않는다.
    const tempId = `pending-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        authorId: viewer.id,
        authorName: viewer.name,
        authorImageUrl: viewer.imageUrl,
        body,
        createdAt: new Date().toISOString(),
        pending: true,
      },
    ]);

    try {
      const result = await sendMessageAction(body);
      if (result.ok) {
        setMessages((prev) => upsert(prev, result.data, tempId));
      } else {
        failSend(tempId, result.error, body);
      }
    } catch {
      failSend(tempId, GENERIC_ERROR, body);
    }
  }

  const realtimeOff = !PUSHER_KEY || !PUSHER_CLUSTER;
  const status = error
    ? { type: 'error' as const, message: error }
    : realtimeOff
      ? { type: 'warning' as const, message: REALTIME_OFF_NOTICE }
      : undefined;

  return (
    <ChatLayout
      composer={
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          placeholder="메시지를 입력하세요"
          status={status}
        />
      }
    >
      <ChatMessageList
        emptyState={
          <EmptyState title="아직 메시지가 없어요" description="첫 메시지로 대화를 시작해 보세요." />
        }
      >
        {messages.map((message) => {
          const mine = message.authorId === viewer.id;
          return (
            <ChatMessage
              key={message.id}
              sender={mine ? 'user' : 'assistant'}
              avatar={
                mine ? undefined : (
                  <Avatar
                    src={message.authorImageUrl ?? undefined}
                    name={message.authorName}
                    size="small"
                  />
                )
              }
            >
              <ChatMessageBubble
                name={mine ? undefined : message.authorName}
                metadata={
                  <ChatMessageMetadata
                    timestamp={
                      message.pending ? '전송 중…' : timeFormat.format(new Date(message.createdAt))
                    }
                  />
                }
              >
                {message.body}
              </ChatMessageBubble>
            </ChatMessage>
          );
        })}
      </ChatMessageList>
    </ChatLayout>
  );
}
