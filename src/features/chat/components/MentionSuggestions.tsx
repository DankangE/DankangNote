'use client';

import { useEffect, useRef } from 'react';
import { AtSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { PickedMention } from '@/features/chat/mentions';

/** 후보 한 줄. @channel은 사람이 아니라 아바타 대신 아이콘을 쓴다. */
export type MentionCandidate = PickedMention & {
  /** 동명이인을 가르는 부가 정보(이메일). @channel은 설명 문구. */
  hint: string | null;
  imageUrl: string | null;
};

/**
 * 컴포저 위에 뜨는 멘션 후보 목록 (KAN-32).
 *
 * 포커스는 옮기지 않는다 — 옮기면 입력이 끊겨 이어서 칠 수 없다. 대신 textarea가 포커스를
 * 쥔 채 방향키·Enter를 가로채고, 여기서는 `aria-activedescendant`가 가리키는 항목을
 * 스크린리더가 읽는다(combobox 패턴). 그래서 항목은 버튼이 아니라 option이다.
 */
export function MentionSuggestions({
  candidates,
  activeIndex,
  listboxId,
  onPick,
}: {
  candidates: MentionCandidate[];
  activeIndex: number;
  listboxId: string;
  onPick: (candidate: MentionCandidate) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  // 방향키로 화면 밖 항목에 닿으면 따라 스크롤한다 — 포커스를 안 옮기므로 브라우저가
  // 대신 해주지 않는다.
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (candidates.length === 0) {
    return null;
  }

  return (
    <ul
      ref={listRef}
      id={listboxId}
      role="listbox"
      aria-label="멘션할 사람"
      className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
    >
      {candidates.map((candidate, index) => (
        <li
          key={`${candidate.kind}:${candidate.userId ?? candidate.label}`}
          id={optionId(listboxId, index)}
          role="option"
          aria-selected={index === activeIndex}
          // 마우스 사용자를 위해 클릭도 받는다. mousedown인 이유: click은 textarea가
          // blur된 뒤에 와서, 그 사이 목록이 닫히면 영영 선택되지 않는다.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(candidate);
          }}
          className={cn(
            'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
            index === activeIndex && 'bg-accent text-accent-foreground',
          )}
        >
          {candidate.kind === 'channel' ? (
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <AtSign className="size-3.5" />
            </span>
          ) : (
            // 폴백은 이름 첫 글자를 텍스트로 그린다 — 숨기지 않으면 옵션의 접근 가능한
            // 이름이 "단 단 강 dan@x.com"처럼 첫 글자가 겹쳐 읽힌다.
            <Avatar aria-hidden className="size-6 shrink-0">
              <AvatarImage src={candidate.imageUrl ?? undefined} alt="" />
              <AvatarFallback>{candidate.label.trim().charAt(0).toUpperCase() || '?'}</AvatarFallback>
            </Avatar>
          )}
          <span className="truncate font-medium">{candidate.label}</span>
          {candidate.hint && (
            <span className="ml-auto truncate text-xs text-muted-foreground">{candidate.hint}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function optionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}
