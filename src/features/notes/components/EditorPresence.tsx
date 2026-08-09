'use client';

import { caretColor } from '@/features/notes/collab-identity';
import type { PresentMember } from '@/features/realtime/presence-members';

// 아바타 줄에 세울 최대 인원. 넘치면 +N으로 접는다 — 문서 폭은 본문의 것이고,
// 스무 명이 들어와도 헤더가 두 줄이 되면 안 된다.
const MAX_FACES = 5;

/**
 * 지금 이 문서를 함께 편집 중인 사람 (KAN-75).
 *
 * 커서와 같은 색을 쓴다 — 본문에서 본 색이 누구인지 여기서 확인된다. 색만으로는
 * 접근성이 안 되므로 이름을 title·aria로 함께 싣는다.
 */
export function EditorPresence({ members }: { members: readonly PresentMember[] }) {
  // 혼자면 아무것도 그리지 않는다. '나 혼자 있음'은 정보가 아니라 소음이다.
  if (members.length <= 1) return null;

  const faces = members.slice(0, MAX_FACES);
  const overflow = members.length - faces.length;

  return (
    <div className="flex items-center gap-2">
      <ul className="flex items-center -space-x-1.5" aria-label="함께 편집 중">
        {faces.map((member) => (
          <li key={member.id}>
            <span
              title={member.name}
              className="flex size-6 items-center justify-center rounded-full border-2 border-background text-[0.625rem] font-medium text-white"
              style={{ backgroundColor: caretColor(member.id) }}
            >
              {member.imageUrl ? (
                // 아바타는 Clerk CDN(원격)이라 next/image의 도메인 설정을 타지 않게
                // 그대로 img를 쓴다 — 24px 고정이라 최적화 이득도 없다.
                // alt는 비운다 — 이름은 아래 sr-only가 읽어 준다(둘 다 두면 두 번 읽힌다).
                // eslint-disable-next-line @next/next/no-img-element
                <img src={member.imageUrl} alt="" className="size-full rounded-full object-cover" />
              ) : (
                <span aria-hidden>{firstLetter(member.name)}</span>
              )}
              <span className="sr-only">{member.name}</span>
            </span>
          </li>
        ))}
        {overflow > 0 ? (
          <li>
            <span className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[0.625rem] font-medium text-muted-foreground">
              +{overflow}
            </span>
          </li>
        ) : null}
      </ul>
      <span className="text-sm text-muted-foreground">{members.length}명이 함께 편집 중</span>
    </div>
  );
}

// 이름의 첫 글자. 빈 이름은 presentMember가 id로 떨어뜨려 오므로 여기선 안 온다.
function firstLetter(name: string): string {
  return [...name.trim()][0] ?? '?';
}
