'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Bell } from 'lucide-react';
import {
  acquirePusher,
  releasePusher,
  subscribeShared,
  unsubscribeShared,
} from '@/features/chat/pusher-connection';
import { Button } from '@/components/ui/button';
import { markNotificationsReadAction } from '@/features/notifications/api/actions';
import {
  EMPTY_NOTIFICATION_PAGE,
  fetchNotifications,
  type NotificationPage,
} from '@/features/notifications/api/queries';
import { NOTIFICATION_EVENT, notificationChannel } from '@/features/notifications/realtime';
import { NotificationPanel } from './NotificationPanel';

// 뱃지에 표시할 최대 숫자. 그 이상은 "99+"로 접는다.
const BADGE_MAX = 99;

// 실시간 신호를 묶는 창. 사람이 체감하지 못할 만큼 짧으면서 @channel 폭주는 한 번으로 접는다.
const REFRESH_COALESCE_MS = 300;

/**
 * 상단바의 알림 종 (KAN-32).
 *
 * 초기 상태를 서버에서 prop으로 받지 않고 마운트 후에 가져온다. 이 컴포넌트가 사는 루트
 * 레이아웃은 org를 모르는 정적 셸이고, 거기에 알림 조회를 끼우면 모든 페이지가 그 조회를
 * 기다리게 된다 — 뱃지 하나 때문에 앱 전체를 동적으로 만들 이유가 없다.
 *
 * 실시간 이벤트는 '새 알림이 있다'는 신호일 뿐이라 내용을 싣지 않는다(actions.ts 참조).
 * 신호를 받으면 다시 물어봐서, 목록과 뱃지가 언제나 서버의 가시성 판정을 통과한 것만
 * 담게 한다.
 */
export function NotificationBell() {
  const { orgId, userId } = useAuth();
  const [page, setPage] = useState<NotificationPage>(EMPTY_NOTIFICATION_PAGE);
  const [open, setOpen] = useState(false);
  // '아직 한 번도 못 받았다'만 구분하면 충분하다. in-flight 플래그를 따로 두면 refresh가
  // 동기적으로 setState하게 되는데, 그건 effect 안에서 부를 수 없다(cascading render).
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // 패널이 닫히면 종으로 포커스를 되돌린다 — 패널이 언마운트되면서 포커스 소유자가
  // 사라지면 키보드 사용자는 문서 맨 위부터 다시 Tab해야 한다(ChatRoom.closeThread와 같다).
  const closePanel = useCallback(() => {
    setOpen(false);
    bellRef.current?.focus();
  }, []);

  // 응답 경합 가드. 조직을 바꾸는 순간에도 이전 조직으로 나간 요청이 뒤늦게 도착할 수
  // 있고, 그걸 그대로 쓰면 새 워크스페이스 화면에 남의 안읽음 수와 발췌가 뜬다.
  // 마운트 조회와 refresh가 같은 카운터를 쓰므로 어느 쪽이 늦게 와도 최신만 반영된다.
  const requestSeq = useRef(0);
  const applyPage = useCallback((seq: number, next: NotificationPage) => {
    if (seq !== requestSeq.current) return;
    setPage(next);
    setLoaded(true);
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    applyPage(seq, await fetchNotifications());
  }, [applyPage]);

  // 실시간 신호를 그대로 조회로 바꾸면 @channel 한 번에 참여자 수만큼의 요청이 동시에
  // 튄다(각자 목록+카운트 쿼리를 돈다). 짧게 묶어 한 번만 물어본다.
  const coalescing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (coalescing.current) return;
    coalescing.current = setTimeout(() => {
      coalescing.current = null;
      void refresh();
    }, REFRESH_COALESCE_MS);
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (coalescing.current) clearTimeout(coalescing.current);
    };
  }, []);

  // 조직이 바뀌면 뱃지를 **즉시** 비운다. effect로 미루면 새 조직의 응답이 올 때까지 남의
  // 워크스페이스 안읽음 수가 화면에 남는다 — 렌더 중에 접어 그 프레임을 아예 없앤다.
  const [seenOrg, setSeenOrg] = useState(orgId);
  if (orgId !== seenOrg) {
    setSeenOrg(orgId);
    setPage(EMPTY_NOTIFICATION_PAGE);
    // loaded도 함께 내린다 — 안 내리면 새 조직을 조회하는 동안 패널이 '불러오는 중'이
    // 아니라 '아직 알림이 없어요'라고 단정한다.
    setLoaded(false);
  }

  // 첫 로드. refresh를 그대로 부르지 않고 여기서 직접 받는 이유는 취소 때문이다 —
  // 조직을 빠르게 바꾸면 먼저 보낸 요청이 나중에 도착해 이전 조직의 알림을 덮어쓴다.
  useEffect(() => {
    if (!orgId || !userId) {
      return;
    }
    const seq = ++requestSeq.current;
    fetchNotifications()
      .then((next) => applyPage(seq, next))
      .catch(() => {
        // 조회 실패는 빈 상태로 둔다(fetchNotifications가 이미 빈 페이지로 흡수한다).
      });
  }, [orgId, userId, applyPage]);

  useEffect(() => {
    if (!orgId || !userId) {
      return;
    }
    // 채팅과 같은 공유 소켓을 쓴다(KAN-56) — 알림 채널 이름은 이 컴포넌트만 구독하지만,
    // 소켓 하나에 웹소켓·재연결 처리가 모이고 페이지의 커넥션이 1개로 줄어든다.
    const client = acquirePusher();
    if (!client) {
      return;
    }
    const name = notificationChannel(orgId, userId);
    const channel = subscribeShared(client, name);
    const onNew = () => scheduleRefresh();
    channel.bind(NOTIFICATION_EVENT, onNew);
    return () => {
      channel.unbind(NOTIFICATION_EVENT, onNew);
      unsubscribeShared(client, name);
      releasePusher();
    };
  }, [orgId, userId, scheduleRefresh]);

  // 바깥을 누르면 닫는다(리액션 팔레트와 같은 이유로 click이 아니라 pointerdown).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  async function markRead(ids?: string[]) {
    // 낙관적으로 먼저 지운다 — 알림은 눌렀는데 뱃지가 한 박자 늦게 내려가면 안 눌린 것처럼
    // 보인다. 실패하면 다음 refresh가 서버 값으로 되돌린다(읽음은 되돌려도 손실이 없다).
    setPage((prev) => ({
      ...prev,
      unread: ids ? Math.max(0, prev.unread - ids.length) : 0,
      notifications: prev.notifications.map((item) =>
        !ids || ids.includes(item.id) ? { ...item, read: true } : item,
      ),
    }));
    try {
      const result = await markNotificationsReadAction({ ids });
      if (!result.ok) {
        void refresh();
      }
    } catch {
      // 오프라인 등으로 액션 호출 자체가 실패하면 낙관 감산이 그대로 굳는다 —
      // 서버 값으로 되돌린다(ChatRoom.handleSend와 같은 처리).
      void refresh();
    }
  }

  if (!orgId || !userId) {
    return null;
  }

  const badge = page.unread > BADGE_MAX ? `${BADGE_MAX}+` : String(page.unread);

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={bellRef}
        variant="ghost"
        size="icon"
        aria-label={page.unread > 0 ? `알림 ${page.unread}건 안읽음` : '알림'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          const next = !open;
          setOpen(next);
          // 열 때마다 다시 받는다 — 다른 탭에서 읽었을 수도, 채널에서 빠졌을 수도 있다.
          if (next) void refresh();
        }}
      >
        <Bell />
        {page.unread > 0 && (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums"
          >
            {badge}
          </span>
        )}
      </Button>

      {open && (
        <NotificationPanel
          id={panelId}
          page={page}
          loading={!loaded}
          onMarkRead={markRead}
          onClose={closePanel}
        />
      )}
    </div>
  );
}
