'use client';

import { useId, useRef, useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  CHANNEL_MENTION,
  mentionText,
  spansForPicked,
  type MentionSpan,
  type PickedMention,
} from '@/features/chat/mentions';
import { MentionSuggestions, optionId, type MentionCandidate } from './MentionSuggestions';

// 슬랙식 컴포저 — 테두리 박스 안에 무테 Textarea + 아이콘 전송 버튼.
// 채널 본문과 스레드 패널이 함께 쓴다(KAN-30). 멘션 자동완성은 KAN-32.
//
// 초안을 여기서 들고 있는 대신 onSend가 성공 여부를 돌려준다: 실패하면 방금 보낸 본문을
// 되돌려 놔야 하는데, 그 복원은 초안을 소유한 쪽만 정확히 할 수 있다.

// 이름에 공백이 있으므로(`@단 강`) 질의도 공백을 포함할 수 있다. 대신 길이로 끊는다 —
// 무한정 받으면 '@' 하나 친 뒤의 문단 전체가 질의가 돼 목록이 영영 안 닫힌다.
const MENTION_QUERY_LIMIT = 24;
const SUGGESTION_LIMIT = 8;

/** 캐럿 앞에서 진행 중인 `@질의`를 찾는다. 없으면 null. */
function activeQuery(draft: string, caret: number): { start: number; query: string } | null {
  const head = draft.slice(0, caret);
  const at = head.lastIndexOf('@');
  if (at < 0) {
    return null;
  }
  // 단어 중간의 '@'(이메일 주소 등)는 멘션이 아니다.
  const before = at > 0 ? head[at - 1] : ' ';
  if (!/\s/.test(before)) {
    return null;
  }
  const query = head.slice(at + 1);
  // 줄바꿈을 넘어가면 그 '@'는 이미 지나간 것이다.
  if (query.length > MENTION_QUERY_LIMIT || query.includes('\n')) {
    return null;
  }
  return { start: at, query };
}

function matches(candidate: MentionCandidate, query: string): boolean {
  if (query === '') {
    return true;
  }
  const needle = query.toLowerCase().replace(/\s+/g, '');
  const haystack = `${candidate.label}${candidate.hint ?? ''}`.toLowerCase().replace(/\s+/g, '');
  return haystack.includes(needle);
}

export function MessageComposer({
  label,
  placeholder,
  disabled,
  people,
  onSend,
}: {
  label: string;
  placeholder: string;
  disabled?: boolean;
  /** 멘션 후보(채널 참여자). 아직 못 받았으면 빈 배열 — 그때는 자동완성이 안 뜬다. */
  people: MentionCandidate[];
  onSend: (body: string, mentions: MentionSpan[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState('');
  // 고른 멘션들. 본문 어디에 있는지는 보낼 때 다시 찾는다(spansForPicked 주석 참조).
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listboxId = useId();

  const candidates = query
    ? [channelCandidate, ...people].filter((c) => matches(c, query.query)).slice(0, SUGGESTION_LIMIT)
    : [];
  const open = candidates.length > 0;
  // 후보가 줄어 인덱스가 밖으로 나갈 수 있다 — 렌더 시점에 접어 둔다.
  const active = Math.min(activeIndex, candidates.length - 1);

  function syncQuery(value: string, caret: number) {
    setQuery(activeQuery(value, caret));
    setActiveIndex(0);
  }

  function pick(candidate: MentionCandidate) {
    if (!query) {
      return;
    }
    const inserted = `${mentionText(candidate.label)} `;
    const next = draft.slice(0, query.start) + inserted + draft.slice(query.start + 1 + query.query.length);
    setDraft(next);
    setPicked((prev) => [...prev, candidate]);
    setQuery(null);
    // 캐럿을 삽입한 이름 뒤로 옮긴다 — 안 옮기면 이어서 친 글자가 이름 앞에 끼어든다.
    const caret = query.start + inserted.length;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

  async function submit() {
    const body = draft.trim();
    if (!body) {
      return;
    }
    // 스팬은 trim된 본문 기준으로 잡아야 한다 — 서버가 검증하는 것도 그 본문이다.
    const mentions = spansForPicked(body, picked);
    setDraft('');
    setPicked([]);
    setQuery(null);
    const ok = await onSend(body, mentions);
    // 그 사이 새로 입력 중이면 사용자의 글을 덮지 않는다.
    if (!ok) {
      setDraft((current) => (current === '' ? body : current));
      setPicked((current) => (current.length === 0 ? picked : current));
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 목록이 떠 있는 동안에는 방향키·Enter·Escape가 목록의 것이다. IME 조합 중에는
    // 넘기지 않는다 — 한글 입력에서 Enter는 조합 확정이지 선택이 아니다.
    if (open && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((prev) => (prev + delta + candidates.length) % candidates.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pick(candidates[active]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setQuery(null);
        return;
      }
    }
    // Enter=전송, Shift+Enter=줄바꿈. 한글 IME 조합 확정 Enter는 무시.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="relative">
      {open && (
        <MentionSuggestions
          candidates={candidates}
          activeIndex={active}
          listboxId={listboxId}
          onPick={pick}
        />
      )}
      <div className="flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <Textarea
          ref={textareaRef}
          aria-label={label}
          // combobox 패턴 — 포커스는 입력에 남고 활성 항목만 가리킨다.
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? optionId(listboxId, active) : undefined}
          aria-autocomplete="list"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="max-h-32 min-h-8 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
          onChange={(event) => {
            setDraft(event.target.value);
            syncQuery(event.target.value, event.target.selectionStart);
          }}
          // 캐럿만 옮겨도 질의 상태가 달라진다(멘션 밖으로 나가면 닫혀야 한다).
          onSelect={(event) => {
            const target = event.target as HTMLTextAreaElement;
            syncQuery(target.value, target.selectionStart);
          }}
          onBlur={() => setQuery(null)}
          onKeyDown={handleKeyDown}
        />
        {/* 데스크톱에서는 본문과 스레드의 컴포저가 동시에 떠 있다 — 두 전송 버튼의 접근
            가능한 이름이 같으면 스크린리더에서 구분되지 않으므로 label을 함께 싣는다. */}
        <Button
          size="icon"
          aria-label={`${label} 보내기`}
          disabled={disabled || draft.trim().length === 0}
          onClick={submit}
        >
          <SendHorizontal />
        </Button>
      </div>
    </div>
  );
}

const channelCandidate: MentionCandidate = {
  kind: 'channel',
  userId: null,
  label: CHANNEL_MENTION,
  hint: '채널 참여자 전체',
  imageUrl: null,
};
