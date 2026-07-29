'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import PusherClient from 'pusher-js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/lib/components/EmptyState';
import { sendMessageAction } from '@/features/chat/api/actions';
import { fetchOlderMessages } from '@/features/chat/api/history';
import { CHAT_MESSAGE_EVENT, chatChannel } from '@/features/chat/realtime';
import type { ChatMessageView, ChatViewer, MessagePage } from '@/features/chat/types';
import { isGrouped, pendingMessage, upsert, type RoomMessage } from '@/features/chat/room-state';
import { ChatMessageRow } from './ChatMessageRow';
import { MessageComposer } from './MessageComposer';
import { ThreadPanel } from './ThreadPanel';

// NEXT_PUBLIC_*은 빌드 시 인라인된다 — 없으면 실시간 구독 없이 동작(경고 표시).
const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
const REALTIME_OFF_NOTICE =
  '실시간 연결이 설정되지 않았어요. 다른 멤버의 새 메시지는 새로고침해야 보입니다.';

// 하단에서 이 픽셀 이내면 "붙어있다"고 보고 새 메시지에 자동 스크롤한다.
const STICK_THRESHOLD_PX = 120;

// 상단에서 이 픽셀 이내로 올라오면 이전 페이지를 당겨온다 — 사용자가 끝에 닿기 전에
// 채워 넣어야 스크롤이 끊기지 않는다.
const LOAD_MORE_THRESHOLD_PX = 200;

// 열려 있는 스레드 패널에 넘길 실시간 답글 버퍼 길이. 패널은 멱등하게 다시 접으므로
// 넉넉히만 잡으면 되고, 세션 내내 무한정 쌓이는 것만 막으면 된다.
const LIVE_REPLY_BUFFER = 50;

export function ChatRoom({
  initialPage,
  viewer,
  channelId,
}: {
  initialPage: MessagePage;
  viewer: ChatViewer;
  channelId: string;
}) {
  // 서버가 준 초기 목록을 시드로, 이후엔 Pusher 이벤트·전송 결과·이전 페이지로만 갱신하는
  // 라이브 스트림 상태. 서버 상태의 사본이 아니라 이벤트 소싱 뷰라 useState가 맞다.
  const [messages, setMessages] = useState<RoomMessage[]>(initialPage.messages);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // 스크린리더용 결과 안내 — 시각적으로는 스크롤 위로 붙은 게 곧 피드백이다.
  const [loadedNotice, setLoadedNotice] = useState('');
  // 열려 있는 스레드의 루트 id와, 실시간으로 도착한 답글 피드(패널로 전달).
  // 한 건짜리 슬롯이 아니라 목록인 이유: 같은 태스크에 두 건이 도착하면 prop이 한 번만
  // 바뀌어 앞의 것이 패널에서 조용히 사라진다(WS 폴백 전송에서 실제로 가능하다).
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [liveReplies, setLiveReplies] = useState<readonly ChatMessageView[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 하단에 붙어있을 때만 새 메시지에 자동 스크롤한다 — 위로 올려 이력을 읽는 중이면
  // 끌어당기지 않는다. 초기 마운트는 붙어있는 상태(true)라 최신이 보인다.
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // 이전 페이지를 앞에 붙일 때 화면에 붙들어 둘 기준 행과 그 행의 화면상 위치.
  // scrollHeight 증가분으로 보정하지 않는 이유가 둘 있다. ① 이 값은 '앞에 붙은 높이'와
  // 같지 않다 — 경계 행이 그룹으로 접히거나(ChatMessageRow) 아래에 새 메시지가 붙으면
  // 어긋난다. ② 기준을 요청 시점에 잡아 두면 응답을 기다리는 사이 도착한 실시간 메시지가
  // 그 보정을 대신 소모해 버린다. 실제로 지키려는 것은 '보고 있던 행이 제자리에 있는 것'
  // 하나뿐이므로 그 행을 직접 기준으로 삼는다.
  const anchor = useRef<{ id: string; viewportTop: number } | null>(null);
  // 이미 요청한 커서를 기억해 같은 페이지를 두 번 받지 않는다. 단순 in-flight 불리언으로는
  // 막지 못한다 — 응답 처리와 실제 커밋 사이에 스크롤 이벤트가 뜨면 그 핸들러는 아직
  // prepend 이전 목록을 캡처하고 있어 같은 커서로 한 번 더 부른다. 실패하면 비워 재시도를 연다.
  const requestedCursor = useRef<string | null>(null);

  const rowNode = (id: string) =>
    listRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`) ?? null;

  const loadOlder = useCallback(async () => {
    const el = listRef.current;
    const oldest = messages[0];
    if (!el || !oldest || !hasMore || requestedCursor.current === oldest.id) return;
    requestedCursor.current = oldest.id;
    setLoadingOlder(true);
    setError(null);
    try {
      const result = await fetchOlderMessages(channelId, oldest.id);
      if (!result.ok) {
        requestedCursor.current = null;
        setError(result.error);
        return;
      }
      setHasMore(result.data.hasMore);
      // 경계에서 겹칠 일은 없지만, 겹치면 조용히 중복 말풍선이 생기므로 걸러 낸다.
      const known = new Set(messages.map((message) => message.id));
      const older = result.data.messages.filter((message) => !known.has(message.id));
      if (older.length === 0) {
        setLoadedNotice('더 불러올 이전 메시지가 없어요.');
        return;
      }
      setLoadedNotice(`이전 메시지 ${older.length}건을 위에 불러왔어요.`);
      // 기준은 목록을 바꾸기 **직전에** 잡는다. 여기서 setMessages까지 사이에 await가 없어
      // 다음 커밋은 반드시 이 prepend다 — 실시간 메시지가 끼어들어 기준을 먹을 수 없다.
      const node = rowNode(oldest.id);
      anchor.current = node ? { id: oldest.id, viewportTop: node.getBoundingClientRect().top } : null;
      setMessages((prev) => [...older, ...prev]);
    } catch {
      requestedCursor.current = null;
      setError(GENERIC_ERROR);
    } finally {
      setLoadingOlder(false);
    }
  }, [channelId, hasMore, messages]);

  function handleListScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    if (el.scrollTop < LOAD_MORE_THRESHOLD_PX) void loadOlder();
  }

  // 스레드를 여는 동안 좁은 화면에서는 본문이 display:none이 된다. 그 사이에는 스크롤
  // 위치를 쓸 수 없어(브라우저가 무시한다) 새 메시지가 와도 하단 추종이 멈춘다 — 패널이
  // 닫히는 순간 따라잡는다. 위로 올려 읽던 중이었다면(stick=false) 건드리지 않는다.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && !openThreadId && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [openThreadId]);

  // 페인트 전에 위치를 잡는다(useEffect면 튄 화면이 한 프레임 보인다).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const pinned = anchor.current;
    if (pinned) {
      anchor.current = null;
      const node = rowNode(pinned.id);
      // 기준 행을 아까 있던 화면 높이로 되돌린다 — 위에 얼마가 붙었든 그대로 맞는다.
      if (node) {
        el.scrollTop += node.getBoundingClientRect().top - pinned.viewportTop;
        return;
      }
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 답글 한 건을 본문의 답글 수에 반영한다. 같은 답글이 두 경로로 들어오므로(내가 보낸
  // 답글은 패널의 전송 성공 + Pusher 에코) id로 한 번만 센다 — 에코만 세면 Pusher가
  // 꺼진 환경에서 영영 안 오르고, 둘 다 세면 두 번 오른다. 중복 배달에도 같은 이유로 안전.
  const countedReplies = useRef(new Set<string>());
  const countReply = useCallback((reply: ChatMessageView) => {
    if (!reply.parentId || countedReplies.current.has(reply.id)) {
      return;
    }
    countedReplies.current.add(reply.id);
    const parentId = reply.parentId;
    setMessages((prev) =>
      prev.map((row) => (row.id === parentId ? { ...row, replyCount: row.replyCount + 1 } : row)),
    );
  }, []);

  useEffect(() => {
    if (!PUSHER_KEY || !PUSHER_CLUSTER) {
      return;
    }
    const client = new PusherClient(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
      channelAuthorization: { transport: 'ajax', endpoint: '/api/pusher/auth' },
    });
    const channel = client.subscribe(chatChannel(channelId));
    const onMessage = (message: ChatMessageView) => {
      // 다른 채널의 이벤트는 버린다 — 채널 전환 직후 이전 구독이 잠깐 살아 있을 수 있다.
      if (message.channelId !== channelId) return;
      if (message.parentId) {
        // 답글은 본문 목록에 섞지 않는다. 스레드 패널로 넘기고, 본문에 있는 루트의
        // 답글 수만 올린다 — 그 루트가 이 페이지에 없으면 아무 일도 일어나지 않는다.
        // 피드는 열려 있는 패널이 훑을 최근분만 남긴다(세션 내내 쌓이지 않게).
        setLiveReplies((prev) => [...prev, message].slice(-LIVE_REPLY_BUFFER));
        countReply(message);
        return;
      }
      setMessages((prev) => upsert(prev, message));
    };
    channel.bind(CHAT_MESSAGE_EVENT, onMessage);
    return () => {
      channel.unbind(CHAT_MESSAGE_EVENT, onMessage);
      client.unsubscribe(chatChannel(channelId));
      client.disconnect();
    };
  }, [channelId, countReply]);

  // 낙관 전송 — 즉시 내 말풍선을 붙이고, 성공하면 서버 확정본으로 교체한다.
  // 실패하면 말풍선을 걷어내고 false를 돌려 컴포저가 본문을 되돌리게 한다.
  async function handleSend(body: string): Promise<boolean> {
    setError(null);
    // 내가 보낸 메시지는 항상 하단으로 스크롤해 보이게 한다.
    stickToBottom.current = true;

    const optimistic = pendingMessage(viewer, channelId, body, null);
    setMessages((prev) => [...prev, optimistic]);

    const fail = (message: string) => {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setError(message);
      return false;
    };

    try {
      const result = await sendMessageAction({ channelId, body });
      if (!result.ok) {
        return fail(result.error);
      }
      setMessages((prev) => upsert(prev, result.data, optimistic.id));
      return true;
    } catch {
      return fail(GENERIC_ERROR);
    }
  }

  // 패널이 서버에서 받은 답글 수를 본문 행에 되돌려 준다 — 실시간 이벤트를 놓쳤거나
  // Pusher가 꺼져 있으면 증가만 하는 카운트는 영영 어긋난 채로 남는다.
  const syncReplyCount = useCallback((rootId: string, replyCount: number) => {
    setMessages((prev) =>
      prev.map((row) => (row.id === rootId ? { ...row, replyCount } : row)),
    );
  }, []);

  // 스레드를 닫으면 열었던 메시지의 답글 버튼으로 포커스를 되돌린다 — 안 그러면 포커스가
  // body로 떨어져 키보드 사용자는 사이드바부터 다시 Tab해야 한다.
  const closeThread = useCallback(() => {
    const rootId = openThreadId;
    setOpenThreadId(null);
    if (!rootId) return;
    // 본문이 다시 그려진 다음에 잡아야 한다(좁은 화면에선 방금까지 display:none이었다).
    requestAnimationFrame(() => {
      rowNode(rootId)?.querySelector<HTMLElement>('button[aria-label$="답글"]')?.focus();
    });
  }, [openThreadId]);

  const realtimeOff = !PUSHER_KEY || !PUSHER_CLUSTER;
  const status = error
    ? { type: 'error' as const, message: error }
    : realtimeOff
      ? { type: 'warning' as const, message: REALTIME_OFF_NOTICE }
      : null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* 스레드가 열리면 좁은 화면에서는 본문을 감추고 패널만 보인다(슬랙 모바일과 같다) —
          두 컬럼을 나란히 두기엔 폭이 모자라 양쪽 다 못 읽게 된다. */}
      <div
        className={cn(
          'min-w-0 flex-1 flex-col',
          openThreadId ? 'hidden md:flex' : 'flex',
        )}
      >
        <div
          ref={listRef}
          onScroll={handleListScroll}
          className="min-h-0 flex-1 overflow-y-auto px-2 py-4 md:px-4"
        >
          {/* 스크롤이 상단에 닿으면 자동으로 당겨오지만 버튼도 함께 둔다 — 스크롤
              이벤트만으로 트리거하면 키보드·스크린리더 사용자는 이력에 닿을 수 없다.
              로딩 중에도 disabled로 두지 않는다: 포커스된 버튼이 disabled가 되면 브라우저가
              포커스를 body로 날려, 페이지를 넘길 때마다 사이드바부터 다시 Tab해야 한다.
              중복 호출은 requestedCursor가 막으므로 눌러도 무해하다. */}
          {hasMore && (
            <div className="flex justify-center pb-2">
              <Button
                variant="ghost"
                size="sm"
                aria-busy={loadingOlder}
                onClick={() => void loadOlder()}
              >
                {loadingOlder ? '불러오는 중…' : '이전 메시지 더 보기'}
              </Button>
            </div>
          )}
          {/* 앞에 붙은 이력은 화면상 위로 삽입돼 시각적으로만 드러난다 — 스크린리더에는
              이 live region이 유일한 단서다. */}
          <p aria-live="polite" className="sr-only">
            {loadedNotice}
          </p>
          {messages.length === 0 ? (
            <div className="px-2">
              <EmptyState
                icon={MessageSquare}
                title="아직 메시지가 없어요"
                description="첫 메시지로 대화를 시작해 보세요."
              />
            </div>
          ) : (
            <div className="flex flex-col">
              {messages.map((message, index) => (
                <ChatMessageRow
                  key={message.id}
                  message={message}
                  grouped={isGrouped(messages[index - 1], message)}
                  onOpenThread={setOpenThreadId}
                />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 px-2 pb-3 md:px-4">
          {status && (
            <p
              // 실패는 즉시 알린다 — 이력 로딩 버튼처럼 화면 반대편에서 눌린 액션의 결과가
              // 여기로 흘러오므로, 조용히 뜨면 아무 일도 안 일어난 것처럼 보인다.
              role={status.type === 'error' ? 'alert' : undefined}
              className={cn(
                'mb-2 text-sm',
                status.type === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {status.message}
            </p>
          )}
          <MessageComposer
            label="메시지"
            placeholder="메시지를 입력하세요 (Shift+Enter 줄바꿈)"
            onSend={handleSend}
          />
        </div>
      </div>

      {openThreadId && (
        <ThreadPanel
          // key로 다른 스레드를 열면 패널 상태(답글 목록·초안)를 새로 시작한다.
          key={openThreadId}
          rootId={openThreadId}
          channelId={channelId}
          viewer={viewer}
          liveReplies={liveReplies}
          onSyncReplyCount={syncReplyCount}
          onReplyCreated={countReply}
          onClose={closeThread}
        />
      )}
    </div>
  );
}
