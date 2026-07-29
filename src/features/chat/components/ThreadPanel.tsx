'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendMessageAction } from '@/features/chat/api/actions';
import { fetchThread } from '@/features/chat/api/history';
import { pendingMessage, upsert, type RoomMessage } from '@/features/chat/room-state';
import type { ChatMessageView, ChatViewer } from '@/features/chat/types';
import { ChatMessageRow } from './ChatMessageRow';
import { MessageComposer } from './MessageComposer';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 슬랙식 스레드 패널. 루트 메시지와 그 답글만 보여주고, 답글에는 다시 답글을 달 수 없다
// (ChatMessageRow에 onOpenThread를 넘기지 않는 것이 그 표현이다 — 서버도 같은 규칙을 강제).
//
// 실시간 답글은 이 패널이 따로 구독하지 않는다. ChatRoom이 이미 채널 하나를 구독하고
// 있으므로 소켓을 하나 더 여는 대신 도착한 답글을 prop으로 받는다.
export function ThreadPanel({
  rootId,
  channelId,
  viewer,
  liveReply,
  onClose,
}: {
  rootId: string;
  channelId: string;
  viewer: ChatViewer;
  liveReply: ChatMessageView | null;
  onClose: () => void;
}) {
  const [root, setRoot] = useState<ChatMessageView | null>(null);
  const [replies, setReplies] = useState<RoomMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 채널 본문과 같은 이유의 앵커 — 이전 답글을 앞에 붙일 때 보던 위치를 지킨다(KAN-29).
  const anchor = useRef<{ id: string; viewportTop: number } | null>(null);
  const requestedCursor = useRef<string | null>(null);

  const rowNode = (id: string) =>
    listRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`) ?? null;

  // 스레드 열기. 이 패널은 rootId로 keying돼 있어(ChatRoom) 스레드가 바뀌면 새로 마운트된다
  // — 그래서 여기서 상태를 되돌릴 필요가 없고, 응답이 왔을 때만 채운다.
  useEffect(() => {
    let cancelled = false;
    fetchThread(rootId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setRoot(result.data.root);
        setReplies(result.data.page.messages);
        setHasMore(result.data.page.hasMore);
      })
      .catch(() => {
        if (!cancelled) setError(GENERIC_ERROR);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rootId]);

  // 다른 사람이 이 스레드에 단 답글(ChatRoom의 구독에서 내려온다). effect가 아니라 렌더
  // 중에 반영하는 이유: prop 변화로부터 파생되는 상태 갱신이라 effect로 두면 커밋 한 번을
  // 더 태우고, 그 사이 한 프레임 동안 답글이 빠진 화면이 보인다.
  // 직전 prop을 state로 들고 비교하는 React 표준 패턴(ref는 렌더 중에 못 읽는다).
  // 같은 이벤트를 두 번 먹지 않게 하고, 내 전송의 echo는 upsert가 거른다.
  const [seenReply, setSeenReply] = useState(liveReply);
  if (liveReply !== seenReply) {
    setSeenReply(liveReply);
    if (liveReply?.parentId === rootId) {
      setReplies((prev) => upsert(prev, liveReply));
    }
  }

  const loadOlder = useCallback(async () => {
    const oldest = replies[0];
    if (!oldest || !hasMore || requestedCursor.current === oldest.id) return;
    requestedCursor.current = oldest.id;
    setError(null);
    try {
      const result = await fetchThread(rootId, oldest.id);
      if (!result.ok) {
        requestedCursor.current = null;
        setError(result.error);
        return;
      }
      setHasMore(result.data.page.hasMore);
      const known = new Set(replies.map((reply) => reply.id));
      const older = result.data.page.messages.filter((reply) => !known.has(reply.id));
      if (older.length === 0) return;
      const node = rowNode(oldest.id);
      anchor.current = node
        ? { id: oldest.id, viewportTop: node.getBoundingClientRect().top }
        : null;
      setReplies((prev) => [...older, ...prev]);
    } catch {
      requestedCursor.current = null;
      setError(GENERIC_ERROR);
    }
  }, [hasMore, replies, rootId]);

  // 새 답글은 아래에 붙으므로 기본은 하단 추종이고, 이전 답글을 붙일 때만 위치를 지킨다.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const pinned = anchor.current;
    if (pinned) {
      anchor.current = null;
      const node = rowNode(pinned.id);
      if (node) {
        el.scrollTop += node.getBoundingClientRect().top - pinned.viewportTop;
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
  }, [replies]);

  async function handleSend(body: string): Promise<boolean> {
    setError(null);
    const optimistic = pendingMessage(viewer, channelId, body, rootId);
    setReplies((prev) => [...prev, optimistic]);

    const fail = (message: string) => {
      setReplies((prev) => prev.filter((reply) => reply.id !== optimistic.id));
      setError(message);
      return false;
    };

    try {
      const result = await sendMessageAction({ channelId, body, parentId: rootId });
      if (!result.ok) {
        return fail(result.error);
      }
      setReplies((prev) => upsert(prev, result.data, optimistic.id));
      return true;
    } catch {
      return fail(GENERIC_ERROR);
    }
  }

  return (
    <aside
      aria-label="스레드"
      className="flex w-full min-w-0 shrink-0 flex-col border-l bg-background md:w-96"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold tracking-tight">스레드</h2>
        <Button variant="ghost" size="icon" className="size-7" aria-label="스레드 닫기" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {loading && <p className="px-2 text-sm text-muted-foreground">불러오는 중…</p>}

        {root && (
          <>
            <ChatMessageRow message={root} grouped={false} />
            <div className="my-2 flex items-center gap-2 px-2 text-xs text-muted-foreground">
              <span className="shrink-0">답글 {root.replyCount}개</span>
              <span aria-hidden className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        {hasMore && (
          <div className="flex justify-center pb-1">
            <Button variant="ghost" size="sm" onClick={() => void loadOlder()}>
              이전 답글 더 보기
            </Button>
          </div>
        )}

        {replies.map((reply, index) => {
          const prev = replies[index - 1];
          const grouped = !!prev && prev.authorId === reply.authorId;
          return <ChatMessageRow key={reply.id} message={reply} grouped={grouped} />;
        })}
      </div>

      <div className="shrink-0 px-2 pb-3">
        {error && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <MessageComposer
          label="답글"
          placeholder="답글을 입력하세요 (Shift+Enter 줄바꿈)"
          onSend={handleSend}
        />
      </div>
    </aside>
  );
}
