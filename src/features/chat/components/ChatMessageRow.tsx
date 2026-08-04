'use client';

import { useState } from 'react';
import { MessageSquareReply } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { ChatMessageView } from '@/features/chat/types';
import { MessageAttachments } from './MessageAttachments';
import { MessageBody } from './MessageBody';
import { ReactionChips, ReactionPicker } from './MessageReactions';

// 타임존 고정 + 오전/오후는 직접 붙인다. 타임존만 고정해선 hydration이 안전하지 않다 —
// 'ko-KR'의 오전/오후 표기는 CLDR 판본에 따라 달라져서, 서버 Node의 ICU와 브라우저의 ICU가
// 다르면 같은 시각이 '오후 10:25'와 'PM 10:25'로 갈린다(실측: Node 22/ICU 78 = PM,
// Chrome = 오후). en-US의 AM/PM은 판본이 달라도 안 흔들리므로 그걸로 받아 한국어로 옮긴다.
const timeParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

function formatClock(date: Date): string {
  const parts = timeParts.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('dayPeriod') === 'AM' ? '오전' : '오후'} ${part('hour')}:${part('minute')}`;
}

type RoomMessage = ChatMessageView & { pending?: boolean };

// 슬랙식 메시지 한 행. grouped(직전과 같은 작성자·5분 내)면 아바타·이름을 접고,
// 접힌 행은 hover 시 거터에 시각을 보여준다.
// onOpenThread가 있으면 스레드 진입점(답글 버튼 · 답글 수)을 붙인다 — 스레드 패널 안에서는
// 넘기지 않는다(답글의 답글은 없다, KAN-30). onToggleReaction은 본문·스레드 양쪽에 붙는다
// (답글에도 리액션은 달 수 있다, KAN-31).
export function ChatMessageRow({
  message,
  grouped,
  viewerId,
  onOpenThread,
  onToggleReaction,
}: {
  message: RoomMessage;
  grouped: boolean;
  /** 나를 부른 멘션을 강조하는 기준(KAN-32). */
  viewerId: string;
  onOpenThread?: (rootId: string) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // 낙관 전송 중인 행은 시각 대신 상태를 보여준다(거터에서는 빈칸).
  const clock = formatClock(new Date(message.createdAt));
  const time = message.pending ? '전송 중…' : clock;
  // 아직 서버 id가 없는 낙관 행은 스레드를 열 수 없다(보드 카드와 같은 제약).
  const threadable = !!onOpenThread && !message.pending;
  // 같은 이유로 리액션도 서버 확정 뒤에야 가능하다 — 임시 id로는 서버가 대상을 못 찾는다.
  const reactable = !!onToggleReaction && !message.pending;
  const toggle = (emoji: string) => onToggleReaction?.(message.id, emoji);

  return (
    <div
      // 이전 페이지를 앞에 붙일 때 이 행을 화면에 붙들어 두기 위한 기준점(ChatRoom).
      data-message-id={message.id}
      className={cn(
        'group relative flex gap-3 rounded-md px-2 hover:bg-accent/40',
        grouped ? 'py-0.5' : 'mt-2 py-1 first:mt-0',
        message.pending && 'opacity-70',
      )}
    >
      {grouped ? (
        <span className="w-9 shrink-0 pt-0.5 text-right text-xs leading-5 text-muted-foreground opacity-0 tabular-nums group-hover:opacity-100">
          {message.pending ? '' : clock}
        </span>
      ) : (
        <Avatar className="mt-0.5 size-9 shrink-0">
          <AvatarImage src={message.authorImageUrl ?? undefined} alt={message.authorName} />
          <AvatarFallback>{message.authorName.trim().charAt(0).toUpperCase() || '?'}</AvatarFallback>
        </Avatar>
      )}

      {/* 호버 툴바가 절대배치라 본문 첫 줄 꼬리를 덮는다 — 버튼 수만큼 오른쪽을 비워
          텍스트 선택이 버튼 클릭으로 새지 않게 한다. */}
      <div
        className={cn(
          'min-w-0 flex-1',
          threadable && reactable ? 'pr-18' : (threadable || reactable) && 'pr-9',
        )}
      >
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{message.authorName}</span>
            <span className="text-xs text-muted-foreground">{time}</span>
          </div>
        )}
        {/* 첨부만 있는 메시지는 본문이 빈 문자열이다(KAN-35) — 빈 문단을 만들지 않는다. */}
        {message.body !== '' && (
          <MessageBody body={message.body} mentions={message.mentions} viewerId={viewerId} />
        )}
        {message.attachments.length > 0 && (
          <MessageAttachments attachments={message.attachments} />
        )}

        {reactable && <ReactionChips reactions={message.reactions} onToggle={toggle} />}

        {threadable && message.replyCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-0.5 h-7 px-1.5 text-xs text-primary"
            onClick={() => onOpenThread(message.id)}
          >
            답글 {message.replyCount}개
          </Button>
        )}
      </div>

      {/* 호버 툴바(리액션 추가 · 답글). 답글이 아직 없는 메시지에도 스레드를 열 수 있어야
          하므로 답글 수 버튼과 별개로 둔다. 터치 기기에는 hover도 :focus-visible도 없어서
          숨기면 영영 안 보인다 — 그래서 md 미만에서는 항상 드러내고, 데스크톱에서만
          hover·포커스로 드러낸다. focus-visible은 툴바 자신이 아니라 그 안의 버튼이 받으므로
          :has()로 받는다(이게 없으면 Tab으로 온 버튼이 투명한 채로 눌린다).
          팔레트가 열려 있는 동안에는 마우스가 벗어나도 계속 보여야 한다. */}
      {(threadable || reactable) && (
        <div
          className={cn(
            'absolute top-0 right-2 flex items-center gap-0.5',
            pickerOpen
              ? 'opacity-100'
              : 'md:opacity-0 md:group-hover:opacity-100 md:has-[:focus-visible]:opacity-100',
          )}
        >
          {reactable && (
            <ReactionPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onPick={toggle}
              ariaLabel={`${message.authorName}의 메시지에 리액션 추가`}
            />
          )}
          {threadable && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${message.authorName}의 메시지에 답글`}
              className="size-7 text-muted-foreground"
              onClick={() => onOpenThread(message.id)}
            >
              <MessageSquareReply />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
