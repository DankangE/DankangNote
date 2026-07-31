'use client';

import { useEffect, useRef } from 'react';
import NextLink from 'next/link';
import { BellOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { NotificationPage, NotificationView } from '@/features/notifications/api/queries';

// 타임존·표기 규칙은 메시지 시각(ChatMessageRow)과 같은 이유로 고정한다 — 서버와 브라우저의
// ICU 판본이 다르면 같은 시각이 다르게 하이드레이션된다.
const dayParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

function formatWhen(iso: string): string {
  const parts = dayParts.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  const clock = `${part('dayPeriod') === 'AM' ? '오전' : '오후'} ${part('hour')}:${part('minute')}`;
  return `${part('month')}월 ${part('day')}일 ${clock}`;
}

/**
 * 알림 항목이 가리키는 곳. 답글이면 스레드까지 열어 준다 — 채널만 열면 답글은 본문에
 * 없으므로(KAN-30) 사용자는 자기가 왜 불렸는지 못 찾는다.
 */
function targetHref(item: NotificationView): string {
  // 루트 메시지 멘션은 채널만 연다. threadRootId가 없을 때 그 메시지 id로 스레드를 열면
  // '답글 0개'짜리 빈 패널이 뜨고, md 미만에서는 본문이 감춰져 있어(hidden md:flex)
  // 모바일 사용자는 정작 대화를 못 본다.
  if (!item.threadRootId) {
    return `/chat/${item.channelId}`;
  }
  return `/chat/${item.channelId}?thread=${encodeURIComponent(item.threadRootId)}`;
}

export function NotificationPanel({
  id,
  page,
  loading,
  onMarkRead,
  onClose,
}: {
  id: string;
  page: NotificationPage;
  loading: boolean;
  onMarkRead: (ids?: string[]) => void;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 열리면 제목으로 포커스를 옮긴다 — 스레드 패널과 같은 이유(무슨 일이 일어났는지 알린다).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div
      id={id}
      // 포커스를 가두지 않으므로 aria-modal은 붙이지 않는다(스레드 패널과 같은 판단).
      role="dialog"
      aria-label="알림"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      // 포커스 이탈로는 닫지 않는다. 이 패널은 마운트하며 제목으로 포커스를 옮기는데,
      // 포커스 불가 영역(헤더 여백·빈 상태 문구)을 클릭하면 포커스가 body로 떨어져
      // relatedTarget이 null이 된다 — 자기 패널 안을 클릭했는데 닫히는 셈이다. 종 버튼을
      // 다시 눌러도 같은 이유로 먼저 닫히고, 이어지는 click이 도로 열어 토글이 안 된다.
      // 바깥 클릭은 종과 패널을 함께 감싼 rootRef의 pointerdown 핸들러가 이미 처리한다.
      className="absolute top-full right-0 z-30 mt-1 flex max-h-[70svh] w-80 flex-col rounded-lg border bg-popover shadow-md sm:w-96"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
          알림
        </h2>
        {page.unread > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onMarkRead()}>
            모두 읽음
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <p aria-live="polite" className="sr-only">
          {loading ? '알림을 불러오는 중' : `안읽은 알림 ${page.unread}건`}
        </p>

        {page.notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <BellOff aria-hidden className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {loading ? '불러오는 중…' : '아직 알림이 없어요.'}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {page.notifications.map((item) => (
              <li key={item.id}>
                <NextLink
                  href={targetHref(item)}
                  onClick={() => {
                    if (!item.read) onMarkRead([item.id]);
                    onClose();
                  }}
                  className={cn(
                    'flex gap-2 rounded-md px-2 py-2 hover:bg-accent',
                    !item.read && 'bg-primary/5',
                  )}
                >
                  <Avatar className="mt-0.5 size-7 shrink-0">
                    <AvatarImage src={item.actorImageUrl ?? undefined} alt="" />
                    <AvatarFallback>
                      {item.actorName.trim().charAt(0).toUpperCase() || '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{item.actorName}</span>
                      <span className="text-muted-foreground">
                        {item.kind === 'channel'
                          ? ` 님이 #${item.channelName}에서 채널 전체를 불렀어요`
                          : ` 님이 #${item.channelName}에서 나를 언급했어요`}
                      </span>
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{item.excerpt}</p>
                    <p className="text-xs text-muted-foreground">{formatWhen(item.createdAt)}</p>
                  </div>
                  {!item.read && (
                    <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
                  )}
                </NextLink>
              </li>
            ))}
          </ul>
        )}

        {/* 더 보기는 아직 두지 않는다 — 한 페이지(20건)를 넘겨 읽을 만큼 알림이 쌓이는
            단계가 아니고, 커서 조회는 서버에 이미 있어 필요해지면 여기만 붙이면 된다. */}
        {page.hasMore && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            더 오래된 알림은 채널에서 확인해 주세요.
          </p>
        )}
      </div>
    </div>
  );
}
