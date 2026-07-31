import { cn } from '@/lib/utils';
import { splitBody, type MentionSpan } from '@/features/chat/mentions';

/**
 * 메시지 본문 — 멘션 구간만 강조해 그린다 (KAN-32).
 *
 * 나를 부른 멘션은 다른 사람 멘션보다 강하게 표시한다. 목록을 훑을 때 '내가 불린 줄'이
 * 바로 눈에 들어와야 알림 센터를 열지 않고도 흐름을 따라갈 수 있다.
 * @channel도 나를 부른 것으로 친다 — 내가 그 채널을 보고 있다는 것이 곧 대상이라는 뜻이다.
 */
export function MessageBody({
  body,
  mentions,
  viewerId,
}: {
  body: string;
  mentions: MentionSpan[];
  viewerId: string;
}) {
  const parts = splitBody(body, mentions);

  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {parts.map((part, index) =>
        part.type === 'text' ? (
          part.text
        ) : (
          <span
            key={index}
            className={cn(
              'rounded px-0.5 font-medium',
              part.kind === 'channel' || part.userId === viewerId
                ? 'bg-primary/15 text-primary'
                : 'text-primary',
            )}
          >
            {part.text}
          </span>
        ),
      )}
    </p>
  );
}
