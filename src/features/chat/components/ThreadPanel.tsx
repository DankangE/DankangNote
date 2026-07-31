'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendMessageAction } from '@/features/chat/api/actions';
import { fetchThread } from '@/features/chat/api/history';
import {
  applyReaction,
  isGrouped,
  pendingMessage,
  upsert,
  type RoomMessage,
} from '@/features/chat/room-state';
import type { MentionSpan } from '@/features/chat/mentions';
import { useReactionToggle } from '@/features/chat/use-reaction-toggle';
import type {
  ChatMessageView,
  ChatViewer,
  LiveReaction,
  ReactionDelta,
} from '@/features/chat/types';
import { ChatMessageRow } from './ChatMessageRow';
import type { MentionCandidate } from './MentionSuggestions';
import { MessageComposer } from './MessageComposer';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

// 피드에서 가장 최근 순번. 마운트 시점의 기준선이자 '어디까지 봤는지'의 갱신값이다.
function lastSeq(feed: readonly LiveReaction[]): number {
  return feed.at(-1)?.seq ?? 0;
}

// 하단에서 이 픽셀 이내면 "붙어있다"고 보고 새 답글에 자동 스크롤한다(본문과 같은 규칙).
const STICK_THRESHOLD_PX = 120;

// 슬랙식 스레드 패널. 루트 메시지와 그 답글만 보여주고, 답글에는 다시 답글을 달 수 없다
// (ChatMessageRow에 onOpenThread를 넘기지 않는 것이 그 표현이다 — 서버도 같은 규칙을 강제).
//
// 실시간 답글은 이 패널이 따로 구독하지 않는다. ChatRoom이 이미 채널 하나를 구독하고
// 있으므로 소켓을 하나 더 여는 대신 도착한 답글 목록을 prop으로 받는다.
export function ThreadPanel({
  rootId,
  channelId,
  viewer,
  liveReplies,
  liveReactions,
  people,
  onSyncReplyCount,
  onReplyCreated,
  onReactionApplied,
  onClose,
}: {
  rootId: string;
  channelId: string;
  viewer: ChatViewer;
  liveReplies: readonly ChatMessageView[];
  liveReactions: readonly LiveReaction[];
  /** 멘션 후보 — 본문과 같은 채널이라 ChatRoom이 받은 것을 그대로 쓴다(KAN-32). */
  people: MentionCandidate[];
  onSyncReplyCount: (rootId: string, replyCount: number) => void;
  onReplyCreated: (reply: ChatMessageView) => void;
  onReactionApplied: (delta: ReactionDelta) => void;
  onClose: () => void;
}) {
  const [root, setRoot] = useState<ChatMessageView | null>(null);
  const [replies, setReplies] = useState<RoomMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stickToBottom = useRef(true);
  // 본문과 같은 이유의 앵커 — 이전 답글을 앞에 붙일 때 보던 위치를 지킨다(KAN-29).
  const anchor = useRef<{ id: string; viewportTop: number } | null>(null);
  const requestedCursor = useRef<string | null>(null);

  const rowNode = (id: string) =>
    listRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`) ?? null;

  // 패널이 열리면 제목으로 포커스를 옮긴다. 좁은 화면에서는 방금 누른 버튼이 통째로
  // 숨겨져 포커스가 body로 떨어지므로, 옮기지 않으면 키보드·스크린리더 사용자는 무슨 일이
  // 일어났는지 알 수 없다.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

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
        // 응답을 기다리는 사이 실시간으로 들어온 답글이 있을 수 있다 — 통째로 덮으면
        // 그 답글이 패널에서만 사라진다(본문의 답글 수는 이미 올라가 있어 더 티가 난다).
        setReplies((pending) =>
          result.data.page.messages.reduce((acc, reply) => upsert(acc, reply), pending),
        );
        setHasMore(result.data.page.hasMore);
        // 본문 목록의 답글 수를 서버 값으로 맞춘다 — 실시간 이벤트를 놓쳤거나 Pusher가
        // 꺼져 있으면 그쪽 카운트는 영영 어긋난 채로 남는다.
        onSyncReplyCount(rootId, result.data.root.replyCount);
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
  }, [rootId, onSyncReplyCount]);

  // 다른 사람이 이 스레드에 단 답글(ChatRoom의 구독에서 내려온다). effect가 아니라 렌더
  // 중에 반영하는 이유: prop 변화로부터 파생되는 상태 갱신이라 effect로 두면 커밋을 한 번
  // 더 태우고, 그 사이 한 프레임 동안 답글이 빠진 화면이 보인다.
  // 직전 prop을 state로 들고 비교하는 React 표준 패턴이다(ref는 렌더 중에 못 읽는다).
  // 배열을 통째로 다시 접는 것은 upsert가 멱등이라 안전하고, 한 번에 여러 건이 도착해
  // prop이 한 번만 바뀌어도 빠뜨리지 않는다.
  const [seenFeed, setSeenFeed] = useState(liveReplies);
  if (liveReplies !== seenFeed) {
    setSeenFeed(liveReplies);
    const mine = liveReplies.filter((reply) => reply.parentId === rootId);
    if (mine.length > 0) {
      setReplies((prev) => mine.reduce((acc, reply) => upsert(acc, reply), prev));
    }
  }

  // 루트와 답글은 서로 다른 state에 있지만 리액션 규칙은 같다 — 한 줄짜리 목록으로 취급해
  // 같은 순수 함수를 양쪽에 돌린다. 이 함수들은 원소를 지우지 않으므로 [0]은 언제나 있다.
  const applyToPanel = useCallback((update: (list: RoomMessage[]) => RoomMessage[]) => {
    setRoot((prev) => (prev ? (update([prev])[0] ?? prev) : prev));
    setReplies(update);
  }, []);

  /**
   * ChatRoom이 모아 주는 리액션 델타 중 이 패널에 있는 메시지의 것만 반영한다.
   * liveReplies와 같은 이유로 effect가 아니라 렌더 중에 접는다(한 프레임 늦은 화면 방지).
   *
   * 답글 피드와 결정적으로 다른 점: 여기서는 **새로 온 것만** 접어야 한다. upsert는 단조라
   * 다시 접어도 같은 결과지만 applyReaction은 절대값 덮어쓰기라, 옛 델타를 다시 적용하면
   * 그 뒤에 올려 둔 낙관 값이나 더 최신 값이 과거로 되돌아간다. 채널 어디서든 리액션이
   * 하나 생기면 피드 배열이 새로 만들어지므로, 그 트리거는 이 스레드와 무관해도 온다.
   */
  const [seen, setSeen] = useState(() => ({ feed: liveReactions, seq: lastSeq(liveReactions) }));
  // 스레드를 아직 못 받은 사이에 온 델타. 빈 목록에 적용하면 그냥 사라지고, 뒤이어 도착한
  // 서버 스냅샷이 옛 카운트로 화면을 굳혀 본문 목록과 영영 갈린다(답글은 upsert 병합으로
  // 같은 창을 막아 뒀다). 루트가 올 때까지 들고 있다가 그 위에 얹는다.
  const [queued, setQueued] = useState<readonly ReactionDelta[]>([]);

  if (liveReactions !== seen.feed) {
    const fresh = liveReactions
      .filter((entry) => entry.seq > seen.seq)
      .map((entry) => entry.delta)
      // 루트의 리액션도 이 패널 안에 그려지므로 messageId === rootId인 델타까지 받는다.
      .filter((delta) => delta.parentId === rootId || delta.messageId === rootId);
    setSeen({ feed: liveReactions, seq: Math.max(seen.seq, lastSeq(liveReactions)) });
    if (fresh.length > 0) {
      if (root) {
        applyToPanel((list) =>
          fresh.reduce((acc, delta) => applyReaction(acc, delta, viewer.id), list),
        );
      } else {
        setQueued((prev) => [...prev, ...fresh]);
      }
    }
  }

  // 루트가 도착하는 순간 기다리던 델타를 그 위에 얹는다. 위와 같은 이유로 effect가 아니라
  // 렌더 중이다 — 서버 스냅샷이 한 프레임 먼저 보이면 그 사이 카운트가 눈에 띄게 튄다.
  // 스냅샷보다 살짝 이른 델타가 섞이면 카운트가 잠깐 1 어긋날 수 있지만(브로드캐스트가
  // 조회보다 먼저 나간 경우) 다음 델타가 바로잡는다 — 통째로 잃어 영영 갈리는 쪽이 나쁘다.
  const [drained, setDrained] = useState(false);
  if (root && !drained) {
    setDrained(true);
    if (queued.length > 0) {
      applyToPanel((list) =>
        queued.reduce((acc, delta) => applyReaction(acc, delta, viewer.id), list),
      );
      setQueued([]);
    }
  }

  const loadOlder = useCallback(async () => {
    const oldest = replies[0];
    if (!oldest || !hasMore || requestedCursor.current === oldest.id) return;
    requestedCursor.current = oldest.id;
    setLoadingOlder(true);
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
      if (older.length === 0) {
        setNotice('더 불러올 이전 답글이 없어요.');
        return;
      }
      setNotice(`이전 답글 ${older.length}건을 위에 불러왔어요.`);
      const node = rowNode(oldest.id);
      anchor.current = node
        ? { id: oldest.id, viewportTop: node.getBoundingClientRect().top }
        : null;
      setReplies((prev) => [...older, ...prev]);
    } catch {
      requestedCursor.current = null;
      setError(GENERIC_ERROR);
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMore, replies, rootId]);

  function handleListScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }

  // 페인트 전에 위치를 잡는다(useEffect면 튄 화면이 한 프레임 보인다 — 본문과 같은 이유).
  useLayoutEffect(() => {
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
    // 위로 올려 예전 답글을 읽는 중이면 새 답글이 와도 끌어내리지 않는다.
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [replies, root]);

  async function handleSend(body: string, mentions: MentionSpan[]): Promise<boolean> {
    setError(null);
    stickToBottom.current = true;
    const optimistic = pendingMessage(viewer, channelId, body, rootId, mentions);
    setReplies((prev) => [...prev, optimistic]);

    const fail = (message: string) => {
      setReplies((prev) => prev.filter((reply) => reply.id !== optimistic.id));
      setError(message);
      return false;
    };

    try {
      const result = await sendMessageAction({ channelId, body, parentId: rootId, mentions });
      if (!result.ok) {
        return fail(result.error);
      }
      setReplies((prev) => upsert(prev, result.data, optimistic.id));
      // 본문의 답글 수를 바로 올린다 — Pusher 에코를 기다리면 실시간이 꺼진 환경에서
      // 영영 안 오른다. 같은 id는 한 번만 세므로 나중에 에코가 와도 중복되지 않는다.
      onReplyCreated(result.data);
      return true;
    } catch {
      return fail(GENERIC_ERROR);
    }
  }

  // 본문과 같은 훅을 쓴다 — 낙관·롤백 규칙이 두 화면에서 갈리지 않게. 확정된 델타는
  // 위로도 올려 보낸다: 루트에 단 리액션은 본문 목록에도 같은 행으로 떠 있다.
  const { toggle } = useReactionToggle({
    viewerId: viewer.id,
    apply: applyToPanel,
    onConfirmed: onReactionApplied,
    onError: setError,
  });

  const handleToggleReaction = (messageId: string, emoji: string) =>
    void toggle(
      root?.id === messageId ? root : replies.find((reply) => reply.id === messageId),
      emoji,
    );

  // 답글 수 표시. 한 페이지 안에 다 들어왔으면 화면에 있는 것이 곧 전부라 그 길이가
  // 가장 정확하다(내 전송·실시간 답글이 즉시 반영된다). 더 있는 경우에만 서버 값을 쓴다.
  const replyCount = hasMore ? (root?.replyCount ?? 0) : replies.length;
  const failedToLoad = !loading && !root;

  return (
    <aside
      // 좁은 화면에서는 본문을 덮는 전체 화면 패널이라 dialog로 알린다. 포커스를 가두지는
      // 않으므로 aria-modal은 붙이지 않는다(거짓말이 된다).
      role="dialog"
      aria-label="스레드"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className="flex w-full min-w-0 shrink-0 flex-col border-l bg-background md:w-96"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold tracking-tight outline-none">
          스레드
        </h2>
        <Button variant="ghost" size="icon" className="size-7" aria-label="스레드 닫기" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div ref={listRef} onScroll={handleListScroll} className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <p aria-live="polite" className="px-2 text-sm text-muted-foreground empty:hidden">
          {loading ? '스레드를 불러오는 중…' : notice}
        </p>

        {root && (
          <>
            <ChatMessageRow
              message={root}
              grouped={false}
              viewerId={viewer.id}
              onToggleReaction={handleToggleReaction}
            />
            <div className="my-2 flex items-center gap-2 px-2 text-xs text-muted-foreground">
              <span className="shrink-0">답글 {replyCount}개</span>
              <span aria-hidden className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        {hasMore && (
          <div className="flex justify-center pb-1">
            <Button
              variant="ghost"
              size="sm"
              aria-busy={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? '불러오는 중…' : '이전 답글 더 보기'}
            </Button>
          </div>
        )}

        {replies.map((reply, index) => (
          <ChatMessageRow
            key={reply.id}
            message={reply}
            grouped={isGrouped(replies[index - 1], reply)}
            viewerId={viewer.id}
            onToggleReaction={handleToggleReaction}
          />
        ))}
      </div>

      <div className="shrink-0 px-2 pb-3">
        {error && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {/* 스레드를 못 불러왔으면 보낼 곳도 없다 — 눌러 봐야 같은 실패가 한 번 더 난다. */}
        <MessageComposer
          label="답글"
          placeholder="답글을 입력하세요 (@로 멘션, Shift+Enter 줄바꿈)"
          disabled={failedToLoad}
          people={people}
          onSend={handleSend}
        />
      </div>
    </aside>
  );
}
