'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import PusherClient from 'pusher-js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/lib/components/EmptyState';
import { markChannelReadAction, sendMessageAction } from '@/features/chat/api/actions';
import { fetchMentionCandidates, fetchOlderMessages } from '@/features/chat/api/history';
import { CHAT_MESSAGE_EVENT, CHAT_REACTION_EVENT, chatChannel } from '@/features/chat/realtime';
import type {
  ChatMessageView,
  ChatViewer,
  LiveReaction,
  MessagePage,
  ReactionDelta,
} from '@/features/chat/types';
import {
  applyReaction,
  isGrouped,
  pendingMessage,
  upsert,
  type RoomMessage,
} from '@/features/chat/room-state';
import type { MentionSpan } from '@/features/chat/mentions';
import { useReactionToggle } from '@/features/chat/use-reaction-toggle';
import { ChatMessageRow } from './ChatMessageRow';
import type { MentionCandidate } from './MentionSuggestions';
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

// 같은 이유의 리액션 델타 버퍼. 리액션은 메시지보다 훨씬 자주 오가므로 더 넉넉히 잡는다.
const LIVE_REACTION_BUFFER = 100;

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
  // 알림에서 온 `?thread=` — 그 스레드를 열어 준다(KAN-32). URL을 상태의 원본으로 삼지
  // 않는 이유는 비용이다: 라우터로 replace하면 서버 컴포넌트가 다시 돌아 메시지 첫 페이지를
  // 통째로 다시 받는다. 여기서는 열고 나서 파라미터만 걷어 낸다.
  //
  // **렌더 중 setState에는 반드시 '값이 달라졌을 때만'이라는 가드가 필요하다.** 렌더 단계
  // 업데이트는 값이 같아도 큐에 그대로 들어가고(react-dom: isRenderPhaseUpdate 분기에는
  // eager 비교 bailout이 없다) 컴포넌트를 다시 돌린다. 조건이 파라미터 하나뿐이면 그 조건은
  // 다음 렌더에도 참이라 루프가 되고, React가 상한에서 'Too many re-renders'로 던진다 —
  // 답글 멘션 알림을 누르면 채팅 화면이 통째로 죽었다.
  // 아래는 매번 seenThreadParam을 바꾸므로 최대 한 번만 다시 돌고 멈춘다.
  const threadParam = useSearchParams().get('thread');
  const [seenThreadParam, setSeenThreadParam] = useState<string | null>(null);
  if (threadParam !== seenThreadParam) {
    setSeenThreadParam(threadParam);
    // 파라미터가 지워질 때(아래 effect)는 열려 있는 스레드를 건드리지 않는다.
    if (threadParam) {
      setOpenThreadId(threadParam);
    }
  }

  // 소비한 파라미터는 지운다. 남겨 두면 ① 스레드를 닫은 뒤 같은 알림을 다시 눌러도 URL이
  // 그대로라 아무 일도 안 일어나고, ② 뒤로 가기로 파라미터 없는 주소에 와도 스레드가 열린
  // 채 남는다. 라우터가 아니라 네이티브 History API를 쓰는 이유는 서버 컴포넌트를 다시
  // 돌리지 않기 위해서다 — Next가 pushState/replaceState를 라우터·useSearchParams와
  // 동기화해 준다(01-app/01-getting-started/04-linking-and-navigating.md).
  useEffect(() => {
    if (threadParam) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [threadParam]);
  const [liveReplies, setLiveReplies] = useState<readonly ChatMessageView[]>([]);
  // 리액션 델타 피드 — 열려 있는 스레드 패널이 자기 몫(루트·답글)을 골라 간다.
  // 순번을 붙여 보내는 이유는 LiveReaction 주석 참조(옛 델타 재적용 방지).
  const [liveReactions, setLiveReactions] = useState<readonly LiveReaction[]>([]);
  const reactionSeq = useRef(0);
  const [error, setError] = useState<string | null>(null);
  // 멘션 후보(채널 참여자). 못 받아도 전송은 되고 자동완성만 안 뜬다 — 컴포저를 막을
  // 이유가 없다. 채널이 바뀌면 다시 받는다.
  const [people, setPeople] = useState<MentionCandidate[]>([]);
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
    const wasStuck = stickToBottom.current;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    // 위로 올려 읽다가 하단으로 돌아온 순간 — 그 사이 쌓인 것을 방금 다 본 것이다.
    // stickToBottom은 ref라 값이 바뀌어도 렌더가 없어서, 여기서 부르지 않으면 새 메시지가
    // 한 건 더 오기 전까지 커서가 그대로 멈춰 있는다.
    if (!wasStuck && stickToBottom.current) {
      markReadIfCaughtUp(messages);
    }
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

  /**
   * 리액션 델타가 들어오는 단 하나의 문. Pusher 이벤트·내 토글 응답·스레드 패널의 토글이
   * 전부 여기로 모인다 — 경로마다 따로 반영하면 같은 메시지가 본문과 패널에 동시에 떠 있는
   * (md 이상) 화면에서 한쪽만 갱신된다.
   *
   * 델타의 count가 절대값이라 몇 번 들어와도, 순서가 뒤바뀌어도 같은 곳에 수렴한다 —
   * 그래서 답글 수(countReply)와 달리 '이미 센 것' 집합을 둘 필요가 없다.
   */
  const applyReactionDelta = useCallback(
    (delta: ReactionDelta) => {
      // 본문에 없는 메시지(답글이거나, 아직 안 불러온 과거 페이지)면 아무 일도 안 일어난다.
      setMessages((prev) => applyReaction(prev, delta, viewer.id));
      reactionSeq.current += 1;
      const entry = { seq: reactionSeq.current, delta };
      setLiveReactions((prev) => [...prev, entry].slice(-LIVE_REACTION_BUFFER));
    },
    [viewer.id],
  );

  const { toggle: toggleReaction, noteServerDelta } = useReactionToggle({
    viewerId: viewer.id,
    apply: setMessages,
    onConfirmed: applyReactionDelta,
    onError: setError,
  });

  // 스레드 패널이 확정한 델타도 이 문으로 들어온다 — 패널에서 루트에 단 리액션은 본문
  // 목록에도 같은 행으로 떠 있고, 롤백 판단(markMyReaction)의 근거도 여기서 갱신돼야 한다.
  const receiveReaction = useCallback(
    (delta: ReactionDelta) => {
      noteServerDelta(delta);
      applyReactionDelta(delta);
    },
    [noteServerDelta, applyReactionDelta],
  );

  useEffect(() => {
    let cancelled = false;
    fetchMentionCandidates(channelId)
      .then((list) => {
        if (!cancelled) setPeople(list);
      })
      .catch(() => {
        // 자동완성이 없을 뿐이라 사용자에게 알리지 않는다.
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

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
    const onReaction = (delta: ReactionDelta) => {
      // 메시지와 같은 이유 — 채널 전환 직후 살아 있는 이전 구독의 이벤트는 버린다.
      if (delta.channelId !== channelId) return;
      receiveReaction(delta);
    };
    channel.bind(CHAT_MESSAGE_EVENT, onMessage);
    channel.bind(CHAT_REACTION_EVENT, onReaction);
    return () => {
      channel.unbind(CHAT_MESSAGE_EVENT, onMessage);
      channel.unbind(CHAT_REACTION_EVENT, onReaction);
      client.unsubscribe(chatChannel(channelId));
      client.disconnect();
    };
  }, [channelId, countReply, receiveReaction]);

  // 낙관 전송 — 즉시 내 말풍선을 붙이고, 성공하면 서버 확정본으로 교체한다.
  // 실패하면 말풍선을 걷어내고 false를 돌려 컴포저가 본문을 되돌리게 한다.
  async function handleSend(body: string, mentions: MentionSpan[]): Promise<boolean> {
    setError(null);
    // 내가 보낸 메시지는 항상 하단으로 스크롤해 보이게 한다.
    stickToBottom.current = true;

    const optimistic = pendingMessage(viewer, channelId, body, null, mentions);
    setMessages((prev) => [...prev, optimistic]);

    const fail = (message: string) => {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setError(message);
      return false;
    };

    try {
      const result = await sendMessageAction({ channelId, body, mentions });
      if (!result.ok) {
        return fail(result.error);
      }
      setMessages((prev) => upsert(prev, result.data, optimistic.id));
      return true;
    } catch {
      return fail(GENERIC_ERROR);
    }
  }

  /**
   * 읽음 커서를 화면에 있는 가장 최신 메시지까지 올린다 (KAN-33).
   *
   * 조건이 셋이다. ① 하단에 붙어 있을 것 — 위로 올려 옛 메시지를 읽는 중이라면 그 아래는
   * 아직 안 본 것이다. ② 탭이 보일 것 — 백그라운드 탭에 메시지가 쌓이는 것을 '읽었다'고
   * 할 수 없다. ③ 낙관 말풍선이 아닐 것 — 서버에 없는 임시 id로는 커서를 세울 수 없다.
   *
   * 같은 메시지로 두 번 보내지 않도록 마지막으로 보낸 id를 기억하고, 실패하면 비워
   * 다음 기회에 다시 시도한다({ok:false}도 실패다 — throw만 잡으면 그 메시지는 영영
   * 재시도되지 않는다).
   *
   * 세 조건은 메시지 도착 말고도 **스크롤·탭 복귀**로 참이 될 수 있다. 그래서 effect가
   * 아니라 함수로 두고 세 경로에서 부른다 — 상태를 흔들어 effect를 다시 돌리는 우회는
   * 목록 전체를 다시 그리고 스크롤 앵커 계산까지 덩달아 태운다.
   */
  const lastMarked = useRef<string | null>(null);
  const markReadIfCaughtUp = useCallback(
    (list: RoomMessage[]) => {
      const newest = [...list].reverse().find((message) => !message.pending);
      if (!newest || !stickToBottom.current || document.visibilityState !== 'visible') {
        return;
      }
      // 스레드가 열려 있으면 멈춘다. xl 미만에서는 본문이 display:none이라 스크롤 위치가
      // 열던 순간 값으로 얼어붙고(브라우저가 이벤트를 안 준다), 그 사이 도착한 메시지가
      // 화면에 뜬 적도 없이 읽음 처리된다.
      if (openThreadId) {
        return;
      }
      if (lastMarked.current === newest.id) {
        return;
      }
      lastMarked.current = newest.id;
      void markChannelReadAction({ channelId, messageId: newest.id })
        .then((result) => {
          if (!result.ok) lastMarked.current = null;
        })
        .catch(() => {
          lastMarked.current = null;
        });
    },
    // openThreadId를 ref가 아니라 의존성으로 받는다 — 그래야 스레드를 닫는 순간 이 콜백의
    // 정체성이 바뀌고, 아래 effect가 그때 밀린 것을 이어서 처리한다.
    [channelId, openThreadId],
  );

  // 스크롤·탭 복귀 핸들러가 최신 목록을 읽게 한다(핸들러는 구독 시점에 고정된다).
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
    markReadIfCaughtUp(messages);
  }, [messages, markReadIfCaughtUp]);

  // 백그라운드에 두고 온 탭으로 돌아오면 그때 밀린 것을 읽음 처리한다 — 숨겨진 동안
  // 쌓인 뒤로는 새 메시지가 안 올 수 있어 목록 변화만으로는 영영 안 걸린다.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        markReadIfCaughtUp(messagesRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markReadIfCaughtUp]);

  const handleToggleReaction = (messageId: string, emoji: string) =>
    void toggleReaction(
      messages.find((message) => message.id === messageId),
      emoji,
    );

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
      {/* 스레드가 열리면 좁은 화면에서는 본문을 감추고 패널만 보인다(슬랙 모바일과 같다).
          기준이 md(768)가 아니라 xl(1280)인 이유는 실측이다: 앱 레일 240 + 채널 사이드바 240
          + 스레드 패널 384 = 864px이 본문 앞에 이미 서 있어서, 768에서는 본문 폭이 0이 되고
          1008에서도 본문 텍스트가 한 글자씩 끊겨 내려간다. 나란히 세울 수 있을 때만 세운다. */}
      <div
        className={cn(
          'min-w-0 flex-1 flex-col',
          openThreadId ? 'hidden xl:flex' : 'flex',
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
                  viewerId={viewer.id}
                  onOpenThread={setOpenThreadId}
                  onToggleReaction={handleToggleReaction}
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
            placeholder="메시지를 입력하세요 (@로 멘션, Shift+Enter 줄바꿈)"
            people={people}
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
          liveReactions={liveReactions}
          people={people}
          onSyncReplyCount={syncReplyCount}
          onReplyCreated={countReply}
          onReactionApplied={receiveReaction}
          onClose={closeThread}
        />
      )}
    </div>
  );
}
