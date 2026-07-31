'use client';

import { useEffect, useRef } from 'react';
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
  if (reactions.length === 0) {
    return null;
  }
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          // 누른 상태를 색으로만 알리면 색각 이상·고대비 모드에서 사라진다. 토글 버튼의
          // 상태는 aria-pressed가 정식 표현이고, 스크린리더도 "선택됨"으로 읽는다.
          aria-pressed={reaction.mine}
          aria-label={`${REACTION_LABELS[reaction.emoji as ReactionEmoji] ?? reaction.emoji} ${reaction.count}명`}
          onClick={() => onToggle(reaction.emoji)}
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
 * 리액션 추가 버튼 + 팔레트. shadcn Popover를 두지 않은 이유는 이 팔레트가 고정 8칸이라
 * 띄우기·충돌 회피가 필요 없어서다 — 필요한 건 바깥 클릭·Escape로 닫는 것뿐이다.
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

  return (
    <div
      ref={rootRef}
      className="relative"
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
        aria-haspopup="true"
        aria-expanded={open}
        className="size-7 text-muted-foreground"
        onClick={() => onOpenChange(!open)}
      >
        <SmilePlus />
      </Button>

      {open && (
        // 오른쪽 끝 행에서 화면 밖으로 나가지 않도록 오른쪽 정렬로 편다.
        <div
          role="group"
          aria-label="리액션 선택"
          className="absolute top-8 right-0 z-20 flex gap-0.5 rounded-lg border bg-popover p-1 shadow-md"
        >
          {REACTION_EMOJIS.map((emoji, index) => (
            <button
              key={emoji}
              ref={index === 0 ? firstEmojiRef : undefined}
              type="button"
              aria-label={REACTION_LABELS[emoji]}
              className="flex size-7 items-center justify-center rounded-md text-base hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
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
