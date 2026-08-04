'use client';

import { useId, useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, SendHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatBytes } from '@/features/chat/attachments';
import {
  CHANNEL_MENTION,
  mentionText,
  spansForPicked,
  type MentionSpan,
  type PickedMention,
} from '@/features/chat/mentions';
import type { AttachmentView } from '@/features/chat/types';
import { useAttachmentUploads, type StagedAttachment } from '@/features/chat/use-attachment-uploads';
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
  channelId,
  attachmentsEnabled,
  onSend,
  onTyping,
}: {
  label: string;
  placeholder: string;
  disabled?: boolean;
  /** 멘션 후보(채널 참여자). 아직 못 받았으면 빈 배열 — 그때는 자동완성이 안 뜬다. */
  people: MentionCandidate[];
  /** 첨부 presign이 붙을 채널 (KAN-35). 스레드 답글도 본문과 같은 채널이다. */
  channelId: string;
  /** 스토리지 env가 없는 환경에서는 첨부 UI 자체를 내리지 않는다(pusher.ts와 같은 태도). */
  attachmentsEnabled: boolean;
  onSend: (body: string, mentions: MentionSpan[], attachments: AttachmentView[]) => Promise<boolean>;
  /**
   * 본문이 바뀔 때마다 불린다(KAN-34). 간격 조절은 호출부의 몫이다 — 컴포저는 '지금 쳤다'는
   * 사실만 알고, 그걸 얼마나 자주 남에게 알릴지는 실시간 계층이 정한다.
   */
  onTyping?: () => void;
}) {
  const [draft, setDraft] = useState('');
  // 고른 멘션들. 본문 어디에 있는지는 보낼 때 다시 찾는다(spansForPicked 주석 참조).
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  // 첨부 준비(선택 → presign → 스토리지 직접 업로드)는 훅이 다 한다(KAN-35).
  const uploads = useAttachmentUploads(channelId);

  const candidates = query
    ? [channelCandidate, ...people].filter((c) => matches(c, query.query)).slice(0, SUGGESTION_LIMIT)
    : [];
  const open = candidates.length > 0;
  // 후보가 줄어 인덱스가 밖으로 나갈 수 있다 — 렌더 시점에 접어 둔다.
  const active = Math.min(activeIndex, candidates.length - 1);

  // 방금 고르고 나서 캐럿을 옮겨 놓은 위치. 그 자리에서는 목록을 열지 않는다 —
  // 안 그러면 pick이 setSelectionRange로 캐럿을 옮기는 순간 onSelect가 돌고, 그 시점의
  // 질의("단 강 ")가 방금 고른 후보와 다시 매칭돼 목록이 되살아난다. 그러면 이어지는
  // Enter가 전송이 아니라 '같은 후보를 다시 고르기'가 되어, 멘션으로 끝나는 메시지는
  // Enter를 세 번 눌러야 나간다(Tab도 같은 이유로 먹힌다).
  const settledCaret = useRef<number | null>(null);

  function syncQuery(value: string, caret: number) {
    if (settledCaret.current === caret) {
      setQuery(null);
      return;
    }
    settledCaret.current = null;
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
    settledCaret.current = caret;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

  // 첨부만으로도 보낼 수 있다(KAN-35). 단 올라가는 중이면 잠근다 — 절반만 실린 메시지를
  // 만들지 않는다. 실패 칩은 전송을 막지 않는다(지우면 그만이고, 성공분은 온전하다).
  const attachments = uploads.ready;
  const canSubmit =
    !disabled && !uploads.uploading && (draft.trim().length > 0 || attachments.length > 0);

  async function submit() {
    if (!canSubmit) {
      return;
    }
    const body = draft.trim();
    // 스팬은 trim된 본문 기준으로 잡아야 한다 — 서버가 검증하는 것도 그 본문이다.
    const mentions = spansForPicked(body, picked);
    setDraft('');
    setPicked([]);
    setQuery(null);
    const ok = await onSend(body, mentions, attachments);
    if (ok) {
      // 성공해야 비운다 — 실패 시 첨부는 그대로 남아 본문 복원과 함께 재전송할 수 있다.
      uploads.clear();
      return;
    }
    // 그 사이 새로 입력 중이면 사용자의 글을 덮지 않는다.
    setDraft((current) => (current === '' ? body : current));
    setPicked((current) => (current.length === 0 ? picked : current));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 목록이 떠 있는 동안에는 방향키·Enter·Escape가 목록의 것이다. IME 조합 중에는
    // 넘기지 않는다 — 한글 입력에서 Enter는 조합 확정이지 선택이 아니다.
    if (open && !event.nativeEvent.isComposing) {
      // 목록이 먹은 키는 위로 올리지 않는다. 특히 Escape — 스레드 패널이 Escape로 닫히므로
      // (ThreadPanel), 후보 목록을 닫으려던 키가 패널을 통째로 닫고 작성 중이던 답글을
      // 날려 버린다. 리액션 팔레트에서 같은 이유로 이미 한 번 겪은 문제다(KAN-31).
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        consume();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((prev) => (prev + delta + candidates.length) % candidates.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        consume();
        pick(candidates[active]);
        return;
      }
      if (event.key === 'Escape') {
        consume();
        setQuery(null);
        return;
      }
    }
    // Enter=전송, Shift+Enter=줄바꿈. 한글 IME 조합 확정 Enter는 무시.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
    // 글을 쓰는 중의 Escape는 위로 올리지 않는다. 스레드 패널이 Escape로 닫히는데
    // (ThreadPanel), 패널은 rootId로 keying돼 있어 다시 열면 새로 마운트된다 — 즉 쓰던
    // 답글이 복구 불가능하게 사라진다. 한국어 IME에서 Escape는 조합 취소로도 흔히 눌린다.
    // 패널을 닫는 길은 남아 있다: 목록·제목·닫기 버튼 어디서든 Escape가 그대로 동작한다.
    if (event.key === 'Escape') {
      event.stopPropagation();
    }
  }

  return (
    <div className="relative">
      {/* 목록이 떴다는 것과 지금 무엇이 선택돼 있는지를 말로 알린다 — 시각적으로는 목록
          자체가 피드백이지만, role을 못 붙이는 입력에서는 이게 유일한 단서다. */}
      <p aria-live="polite" className="sr-only">
        {open ? `멘션 후보 ${candidates.length}명, ${candidates[active]?.label} 선택됨` : ''}
      </p>
      {open && (
        <MentionSuggestions
          candidates={candidates}
          activeIndex={active}
          listboxId={listboxId}
          onPick={pick}
        />
      )}
      <div className="flex flex-col gap-1.5 rounded-xl border bg-background p-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {uploads.notice && (
          <p role="alert" className="px-1 text-xs text-destructive">
            {uploads.notice}
          </p>
        )}
        {uploads.items.length > 0 && (
          <ul aria-label="첨부할 파일" className="flex flex-wrap gap-2 px-1 pt-1">
            {uploads.items.map((item) => (
              <AttachmentChip key={item.localId} item={item} onRemove={uploads.remove} />
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
        {attachmentsEnabled && (
          <>
            {/* 값 초기화(onClick) — 같은 파일을 지웠다 다시 고를 때 change가 안 뜨는 것을 막는다. */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onClick={(event) => {
                (event.target as HTMLInputElement).value = '';
              }}
              onChange={(event) => {
                if (event.target.files) uploads.stage([...event.target.files]);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${label}에 파일 첨부`}
              disabled={disabled}
              className="size-8 shrink-0 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip />
            </Button>
          </>
        )}
        <Textarea
          ref={textareaRef}
          aria-label={label}
          // role="combobox"를 붙이지 않는다. ARIA in HTML은 textarea에 role 재지정을
          // 허용하지 않고(axe aria-allowed-role), 실제로도 스크린리더가 '여러 줄 편집'이
          // 아니라 '콤보 상자'로 읽어 Shift+Enter 줄바꿈 안내와 어긋난다. 자동완성되는
          // 멀티라인 입력에 맞는 role이 ARIA에 없다 — 그래서 textbox에도 유효한
          // aria-activedescendant로 활성 항목만 가리키고, 목록의 존재는 아래 live region이
          // 말로 알린다.
          aria-activedescendant={open ? optionId(listboxId, active) : undefined}
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="max-h-32 min-h-8 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
          onChange={(event) => {
            setDraft(event.target.value);
            syncQuery(event.target.value, event.target.selectionStart);
            // 지우는 것도 입력이다 — 상대가 기다리는 동안 무엇이 일어나고 있는지가 표시의
            // 목적이라, 글이 늘었는지로 가르지 않는다. 다만 빈 칸이 된 순간은 뺀다:
            // 쓰던 것을 다 지운 사람을 몇 초 더 '입력 중'으로 붙들어 둘 이유가 없다.
            if (event.target.value !== '') {
              onTyping?.();
            }
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
            가능한 이름이 같으면 스크린리더에서 구분되지 않으므로 label을 함께 싣는다.
            업로드 중에는 잠근다(aria-busy) — 절반만 실린 메시지를 만들지 않는다. */}
        <Button
          size="icon"
          aria-label={`${label} 보내기`}
          aria-busy={uploads.uploading}
          disabled={!canSubmit}
          onClick={submit}
        >
          <SendHorizontal />
        </Button>
        </div>
      </div>
    </div>
  );
}

// 첨부 대기줄의 칩 하나 (KAN-35). 이미지에는 로컬 미리보기(objectURL)를, 나머지에는 파일
// 아이콘을 쓴다 — 서버 주소로 미리보기를 그리면 업로드가 끝나기 전엔 어차피 깨진다.
function AttachmentChip({
  item,
  onRemove,
}: {
  item: StagedAttachment;
  onRemove: (localId: string) => void;
}) {
  return (
    <li
      className={cn(
        'relative flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-7 pl-1.5 text-xs',
        item.status === 'error' && 'border-destructive text-destructive',
      )}
    >
      {item.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.previewUrl} alt="" className="size-8 rounded object-cover" />
      ) : (
        <FileText aria-hidden className="size-4 text-muted-foreground" />
      )}
      <span className="flex flex-col">
        <span className="max-w-36 truncate font-medium">{item.fileName}</span>
        <span className={cn('text-muted-foreground', item.status === 'error' && 'text-destructive')}>
          {item.status === 'error' ? item.error : formatBytes(item.size)}
        </span>
      </span>
      {item.status === 'uploading' && (
        <Loader2 aria-hidden className="size-3.5 animate-spin text-muted-foreground" />
      )}
      {/* 진행 상태는 시각으로만 드러난다 — 스크린리더에는 이 텍스트가 유일한 단서다. */}
      <span className="sr-only">
        {item.status === 'uploading' ? '업로드 중' : item.status === 'ready' ? '업로드 완료' : ''}
      </span>
      <button
        type="button"
        aria-label={`${item.fileName} 첨부 지우기`}
        className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => onRemove(item.localId)}
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

const channelCandidate: MentionCandidate = {
  kind: 'channel',
  userId: null,
  label: CHANNEL_MENTION,
  hint: '채널 참여자 전체',
  imageUrl: null,
};
