'use client';

import { useEffect, useRef, useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import PusherClient from 'pusher-js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/lib/components/EmptyState';
import { sendMessageAction } from '@/features/chat/api/actions';
import { CHAT_MESSAGE_EVENT, orgChannel } from '@/features/chat/realtime';
import type { ChatMessageView, ChatViewer } from '@/features/chat/types';
import { ChatMessageRow } from './ChatMessageRow';

// NEXT_PUBLIC_*은 빌드 시 인라인된다 — 없으면 실시간 구독 없이 동작(경고 표시).
const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
const REALTIME_OFF_NOTICE =
  '실시간 연결이 설정되지 않았어요. 다른 멤버의 새 메시지는 새로고침해야 보입니다.';

// 같은 작성자의 연속 메시지를 한 묶음으로 접는(슬랙식) 시간 창.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

// 하단에서 이 픽셀 이내면 "붙어있다"고 보고 새 메시지에 자동 스크롤한다.
const STICK_THRESHOLD_PX = 120;

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
  // 하단에 붙어있을 때만 새 메시지에 자동 스크롤한다 — 위로 올려 이력을 읽는 중이면
  // 끌어당기지 않는다. 초기 마운트는 붙어있는 상태(true)라 최신이 보인다.
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  function handleListScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

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

  async function handleSubmit() {
    const body = draft.trim();
    if (!body) {
      return;
    }
    setError(null);
    setDraft('');
    // 내가 보낸 메시지는 항상 하단으로 스크롤해 보이게 한다.
    stickToBottom.current = true;

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
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-4 md:px-4"
      >
        {messages.length === 0 ? (
          <div className="px-2">
            <EmptyState title="아직 메시지가 없어요" description="첫 메시지로 대화를 시작해 보세요." />
          </div>
        ) : (
          <div className="flex flex-col">
            {messages.map((message, index) => {
              // 같은 작성자의 연속 메시지(5분 내)는 아바타·이름을 접는다(슬랙식 그룹).
              const prev = messages[index - 1];
              const grouped =
                !!prev &&
                prev.authorId === message.authorId &&
                new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() <
                  GROUP_WINDOW_MS;
              return <ChatMessageRow key={message.id} message={message} grouped={grouped} />;
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 px-2 pb-3 md:px-4">
        {status && (
          <p
            className={cn(
              'mb-2 text-sm',
              status.type === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {status.message}
          </p>
        )}
        {/* 슬랙식 컴포저 — 테두리 박스 안에 무테 Textarea + 아이콘 전송 버튼. */}
        <div className="flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <Textarea
            aria-label="메시지"
            value={draft}
            placeholder="메시지를 입력하세요 (Shift+Enter 줄바꿈)"
            rows={1}
            className="max-h-32 min-h-8 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter=전송, Shift+Enter=줄바꿈. 한글 IME 조합 확정 Enter는 무시.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                handleSubmit();
              }
            }}
          />
          <Button
            size="icon"
            aria-label="보내기"
            disabled={draft.trim().length === 0}
            onClick={handleSubmit}
          >
            <SendHorizontal />
          </Button>
        </div>
      </div>
    </div>
  );
}
