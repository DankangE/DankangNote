'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { typingLabel, type PresentMember, type TypingEntry } from '@/features/chat/presence';

// 얼굴은 다섯까지만 세운다 — 그 이상은 겹쳐 봐야 누군지 못 알아보고 폭만 먹는다.
const MAX_FACES = 5;

/**
 * 컴포저 바로 위의 활동 표시줄 (KAN-34) — 누가 이 채널을 보고 있고, 누가 지금 쓰고 있는지.
 *
 * 헤더가 아니라 여기 두는 이유는 두 가지다. 헤더의 `참여 N명`은 명단(누가 이 채널에
 * 속하는가)이고 이건 지금 이 순간(누가 보고 있는가)이라 나란히 두면 서로를 부정하는
 * 숫자처럼 읽힌다. 그리고 입력 중 표시는 관례상 입력란 바로 위다.
 *
 * 높이를 늘 확보해 둔다 — 문구가 떴다 사라질 때마다 컴포저와 메시지 목록이 아래위로 튄다.
 */
export function ChannelActivityBar({
  members,
  typing,
}: {
  members: readonly PresentMember[];
  typing: readonly TypingEntry[];
}) {
  const label = typingLabel(typing, members);
  const faces = members.slice(0, MAX_FACES);

  return (
    <div className="flex min-h-6 items-center gap-3 px-1 text-xs text-muted-foreground">
      {/* 문구가 바뀔 때만 읽히도록 live region은 늘 자리에 있어야 한다(조건부로 마운트하면
          스크린리더가 새 노드로 보고 놓친다). */}
      <p aria-live="polite" className="min-w-0 flex-1 truncate">
        {label && (
          <span className="inline-flex items-center gap-1.5">
            <TypingDots />
            {label}
          </span>
        )}
      </p>

      {members.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5">
          {/* 아바타는 장식이다 — 같은 정보를 아래 sr-only 문장이 이름까지 담아 말한다. */}
          <div className="flex -space-x-1.5" aria-hidden>
            {faces.map((member) => (
              <Avatar key={member.id} className="size-5 ring-2 ring-background">
                <AvatarImage src={member.imageUrl ?? undefined} alt="" />
                <AvatarFallback className="text-[10px]">
                  {member.name.trim().charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
          <span aria-hidden className="inline-flex items-center gap-1 tabular-nums">
            <span className="size-1.5 rounded-full bg-success" />
            {members.length}
          </span>
          <span className="sr-only">
            {`이 채널을 보고 있는 사람 ${members.length}명: ${members
              .map((member) => member.name)
              .join(', ')}`}
          </span>
        </div>
      )}
    </div>
  );
}

// 통통 튀는 점 셋. 문구만으로도 뜻은 전해지지만, 이 표시는 '지금 이 순간'이라는 게 핵심이라
// 움직임이 있어야 멈춘 화면과 구분된다. 접근성 트리에는 넣지 않는다(문구가 이미 말한다).
function TypingDots() {
  return (
    <span aria-hidden className="flex items-center gap-0.5">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          // 지연은 프레임마다 계산되는 값이 아니라 상수지만, Tailwind 임의 값으로 쓰면
          // 클래스가 세 벌 생긴다 — 세 점의 유일한 차이라 인라인이 더 정직하다.
          style={{ animationDelay: `${delay}ms` }}
          className="size-1 animate-bounce rounded-full bg-muted-foreground/70"
        />
      ))}
    </span>
  );
}
