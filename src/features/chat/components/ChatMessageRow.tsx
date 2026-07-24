import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { ChatMessageView } from '@/features/chat/types';

// 타임존 고정 — 서버/클라 동일 결과라 hydration이 안전하다 (NoteCard와 같은 이유).
const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
});

type RoomMessage = ChatMessageView & { pending?: boolean };

// 슬랙식 메시지 한 행. grouped(직전과 같은 작성자·5분 내)면 아바타·이름을 접고,
// 접힌 행은 hover 시 거터에 시각을 보여준다.
export function ChatMessageRow({ message, grouped }: { message: RoomMessage; grouped: boolean }) {
  const time = message.pending ? '전송 중…' : timeFormat.format(new Date(message.createdAt));

  return (
    <div
      className={cn(
        'group flex gap-3 rounded-md px-2 hover:bg-accent/40',
        grouped ? 'py-0.5' : 'mt-2 py-1 first:mt-0',
        message.pending && 'opacity-70',
      )}
    >
      {grouped ? (
        <span className="w-9 shrink-0 pt-0.5 text-right text-xs leading-5 text-muted-foreground opacity-0 tabular-nums group-hover:opacity-100">
          {message.pending ? '' : timeFormat.format(new Date(message.createdAt))}
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
      </div>
    </div>
  );
}
