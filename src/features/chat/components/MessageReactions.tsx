'use client';

import { useEffect, useRef, type FocusEvent } from 'react';
import { SmilePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { REACTION_EMOJIS, REACTION_LABELS, type ReactionEmoji } from '@/features/chat/reactions';
import type { ReactionView } from '@/features/chat/types';

/** 메시지 아래에 붙는 리액션 칩 줄. 하나도 없으면 아무것도 그리지 않는다. */
export function ReactionChips({
  reactions,
  onToggle,
}: {
  reactions: ReactionView[];
  onToggle: (emoji: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // 마지막 한 명(=나)이 취소하면 그 칩이 통째로 사라진다. 방금 누른 버튼이 언마운트되면
  // 포커스가 body로 떨어져, 키보드 사용자는 다음 Tab을 문서 맨 위에서 다시 시작하게 된다.
  // 사라지기 전에 옆 칩으로, 그것도 없으면 같은 행의 리액션 추가 버튼으로 옮겨 둔다.
  const handleClick = (reaction: ReactionView, index: number) => {
    if (reaction.mine && reaction.count === 1) {
      const chips = listRef.current?.querySelectorAll<HTMLElement>('button') ?? [];
      const sibling = chips[index + 1] ?? chips[index - 1];
      const fallback = listRef.current
        ?.closest('[data-message-id]')
        ?.querySelector<HTMLElement>('button[aria-haspopup]');
      (sibling ?? fallback)?.focus();
    }
    onToggle(reaction.emoji);
  };

  if (reactions.length === 0) {
    return null;
  }
  return (
    <div ref={listRef} className="mt-1 flex flex-wrap gap-1">
      {reactions.map((reaction, index) => (
        <button
          key={reaction.emoji}
          type="button"
          // 누른 상태를 색으로만 알리면 색각 이상·고대비 모드에서 사라진다. 토글 버튼의
          // 상태는 aria-pressed가 정식 표현이고, 스크린리더도 "선택됨"으로 읽는다.
          aria-pressed={reaction.mine}
          aria-label={`${REACTION_LABELS[reaction.emoji as ReactionEmoji] ?? reaction.emoji} ${reaction.count}명`}
          onClick={() => handleClick(reaction, index)}
          className={cn(
            'flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors',
            reaction.mine
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted',
          )}
        >
          <span aria-hidden>{reaction.emoji}</span>
          {reaction.count}
        </button>
      ))}
    </div>
  );
}

/**
 * 리액션 추가 버튼 + 팔레트. shadcn Popover(Base UI 포지셔닝 엔진)를 끌어오지 않고 고정
 * 배치로 둔 것은, 이 팔레트가 폭이 정해진 8칸이라 가로 충돌만 막으면 되기 때문이다
 * (오른쪽 정렬). 대신 세로는 뒤집지 않아서, 스크롤 맨 아래 메시지에서는 팔레트 아랫단
 * 몇 px이 잘린다 — 버튼은 전부 눌리는 정도라 두고, 위쪽 공간까지 재야 할 만큼 팔레트가
 * 커지면 그때 Popover로 바꾼다.
 *
 * open을 부모가 들고 있는 것은 접근성 때문이다: 호버 툴바는 마우스가 벗어나면 opacity 0이
 * 되는데, 열린 팔레트가 그렇게 사라지면 키보드로 연 사용자는 갈 곳을 잃는다. 부모가
 * '열려 있으면 계속 보이게' 결정해야 해서 상태가 위에 있다.
 */
export function ReactionPicker({
  open,
  onOpenChange,
  onPick,
  ariaLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (emoji: ReactionEmoji) => void;
  ariaLabel: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstEmojiRef = useRef<HTMLButtonElement>(null);

  // 열면 첫 이모지로 포커스를 옮긴다 — 안 옮기면 키보드 사용자는 열어 놓고도 팔레트에
  // 닿기 위해 Tab을 몇 번 눌러야 하는지 알 수 없다.
  useEffect(() => {
    if (open) firstEmojiRef.current?.focus();
  }, [open]);

  // 바깥을 누르면 닫는다. click이 아니라 pointerdown인 이유: click은 누른 곳과 뗀 곳이
  // 모두 같아야 발생해서, 팔레트 밖에서 눌러 드래그하면 열린 채로 남는다.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onOpenChange]);

  const close = (returnFocus: boolean) => {
    onOpenChange(false);
    // 팔레트가 사라지면 포커스가 body로 떨어진다 — 트리거로 되돌려야 이어서 조작할 수 있다.
    if (returnFocus) triggerRef.current?.focus();
  };

  // 포커스가 이 묶음 밖으로 나가면 닫는다. Tab으로 마지막 이모지를 지나면 포커스는 바로
  // 옆(같은 툴바의 답글 버튼)으로 가는데, 그건 rootRef 밖이라 바깥 클릭에도 Escape에도
  // 걸리지 않는다 — 팔레트가 열린 채로 남아 툴바가 계속 떠 있고, 그 상태의 Escape는
  // 스레드 패널까지 올라가 패널을 통째로 닫는다.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (open && !event.currentTarget.contains(event.relatedTarget)) {
      onOpenChange(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // 스레드 패널의 Escape(패널 닫기)까지 올라가지 않게 여기서 멈춘다 —
          // 팔레트를 닫으려다 패널이 통째로 닫히면 방금 읽던 스레드를 잃는다.
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        aria-label={ariaLabel}
        // menu가 아니라 dialog다. aria-haspopup="true"는 명세상 "menu"와 같은 뜻이라
        // 스크린리더가 메뉴로 알리고, 사용자는 화살표 키 로빙을 기대하는데 여기엔 없다.
        // 실제 내용물(버튼 8개를 Tab으로 훑는 작은 팝업)에 맞는 이름이 dialog다.
        aria-haspopup="dialog"
        aria-expanded={open}
        className="size-7 text-muted-foreground"
        onClick={() => onOpenChange(!open)}
      >
        <SmilePlus />
      </Button>

      {open && (
        // 오른쪽 끝 행에서 화면 밖으로 나가지 않도록 오른쪽 정렬로 편다.
        <div
          // 포커스를 가두지 않으므로 aria-modal은 붙이지 않는다(스레드 패널과 같은 판단) —
          // 대신 포커스가 나가면 닫혀서, 열린 채로 뒤에 남는 상태가 생기지 않는다.
          role="dialog"
          aria-label="리액션 선택"
          className="absolute top-8 right-0 z-20 flex gap-0.5 rounded-lg border bg-popover p-1 shadow-md"
        >
          {REACTION_EMOJIS.map((emoji, index) => (
            <button
              key={emoji}
              ref={index === 0 ? firstEmojiRef : undefined}
              type="button"
              aria-label={REACTION_LABELS[emoji]}
              // 포커스 표시는 배경색이 아니라 링이어야 한다. accent 배경은 popover 배경과
              // 대비가 1.1:1 남짓이라(WCAG 2.4.11은 3:1) 사실상 안 보이고, hover와도
              // 구분되지 않는다 — 여는 순간 포커스가 여기로 들어오므로 더 치명적이다.
              // 링 값은 shadcn Button의 focus-visible과 같은 것을 쓴다.
              className="flex size-7 items-center justify-center rounded-md text-base hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => {
                onPick(emoji);
                close(true);
              }}
            >
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
