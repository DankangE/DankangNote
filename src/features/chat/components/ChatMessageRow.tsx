import { MessageSquareReply } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { ChatMessageView } from '@/features/chat/types';

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
// 넘기지 않는다(답글의 답글은 없다, KAN-30).
export function ChatMessageRow({
  message,
  grouped,
  onOpenThread,
}: {
  message: RoomMessage;
  grouped: boolean;
  onOpenThread?: (rootId: string) => void;
}) {
  // 낙관 전송 중인 행은 시각 대신 상태를 보여준다(거터에서는 빈칸).
  const clock = formatClock(new Date(message.createdAt));
  const time = message.pending ? '전송 중…' : clock;
  // 아직 서버 id가 없는 낙관 행은 스레드를 열 수 없다(보드 카드와 같은 제약).
  const threadable = !!onOpenThread && !message.pending;

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

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{message.authorName}</span>
            <span className="text-xs text-muted-foreground">{time}</span>
          </div>
        )}
        <p className="text-sm break-words whitespace-pre-wrap">{message.body}</p>

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

      {/* hover 진입점. 답글이 아직 없는 메시지에도 스레드를 열 수 있어야 한다.
          sr-only가 아니라 opacity로 숨기는 이유: 포커스 시 드러나야 키보드로도 닿는다. */}
      {threadable && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${message.authorName}의 메시지에 답글`}
          className="absolute top-0 right-2 size-7 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => onOpenThread(message.id)}
        >
          <MessageSquareReply />
        </Button>
      )}
    </div>
  );
}
