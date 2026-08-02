// 프레즌스·타이핑의 순수 상태 계산 (KAN-34). 훅에서 떼어 둔 이유는 여기 규칙 대부분이
// 시간에 얽혀 있어서다 — 만료·중복·이름 해석은 타이머 없이 now를 넣어 확인할 수 있어야 한다.

/** 지금 이 채널을 열어 두고 있는 사람. name·imageUrl은 채널 인증이 실어 보낸 표시 정보다. */
export type PresentMember = {
  id: string;
  name: string;
  imageUrl: string | null;
};

/** 타이핑 한 건 — 언제까지 '입력 중'으로 보여줄지. */
export type TypingEntry = {
  userId: string;
  expiresAt: number;
};

/**
 * 타이핑 핑을 보내는 최소 간격. 글자마다 보내면 채널 하나에 초당 수십 건이 오간다.
 */
export const TYPING_PING_MS = 2_500;

/**
 * 받은 핑을 '입력 중'으로 유지하는 시간. **핑 간격보다 넉넉히 길어야 한다** — 같으면
 * 왕복 지연만큼 매번 비어 인디케이터가 계속 깜빡인다. 반대로 너무 길면 입력을 멈춘 뒤에도
 * 남는다. 멈춤 신호를 따로 보내지 않는 대신(끊긴 브라우저는 그것도 못 보낸다) 이 만료가
 * 유일한 정리 수단이라, 간격의 두 배 남짓으로 둔다.
 */
export const TYPING_TTL_MS = 6_000;

/** 이름을 모르는 사람(프레즌스 목록에 아직 없다)을 가리키는 말. */
const UNKNOWN_TYPIST = '누군가';

/** 객체에서 문자열 필드 하나를 안전하게 읽는다. 비었거나 문자열이 아니면 null. */
function readString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) {
    return null;
  }
  const value = Reflect.get(source, key);
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * pusher-js가 넘겨주는 멤버(`{ id, info }`)를 우리 모델로 옮긴다. 못 알아보면 null.
 *
 * info는 우리 채널 인증이 만든 값이지만 라이브러리 타입이 느슨해(any) 여기서 모양을
 * 다시 본다. 이름이 비어 있으면 id로 떨어뜨린다 — 목록에서 사람이 통째로 사라지는 것보다
 * 못생긴 이름이 낫다.
 */
export function presentMember(id: unknown, info: unknown): PresentMember | null {
  if (typeof id !== 'string' || id === '') {
    return null;
  }
  return {
    id,
    name: readString(info, 'name') ?? id,
    imageUrl: readString(info, 'imageUrl'),
  };
}

/** 멤버를 넣는다(같은 id는 갈아끼운다). 탭을 여럿 열어도 사람은 하나로 센다. */
export function withMember(
  members: readonly PresentMember[],
  member: PresentMember,
): PresentMember[] {
  return sortMembers([...members.filter((entry) => entry.id !== member.id), member]);
}

export function withoutMember(
  members: readonly PresentMember[],
  id: string,
): readonly PresentMember[] {
  const kept = members.filter((entry) => entry.id !== id);
  return kept.length === members.length ? members : kept;
}

// 이름순으로 고정한다 — 정렬이 없으면 도착 순서가 곧 순서라, 아무도 들어오고 나가지
// 않았는데도 재접속 한 번에 아바타 줄이 통째로 뒤바뀐다.
export function sortMembers(members: readonly PresentMember[]): PresentMember[] {
  return [...members].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/**
 * 타이핑 핑 하나를 반영한다. 같은 사람의 앞선 항목은 새 만료로 갈아끼운다 —
 * 쌓아 두면 '3명이 입력 중'이 사실은 한 사람이 세 번 친 것이 된다.
 */
export function noteTyping(
  entries: readonly TypingEntry[],
  userId: string,
  now: number,
): TypingEntry[] {
  const others = entries.filter((entry) => entry.userId !== userId && entry.expiresAt > now);
  return [...others, { userId, expiresAt: now + TYPING_TTL_MS }];
}

/**
 * 만료된 항목을 걷어낸다.
 *
 * **바뀐 게 없으면 받은 배열을 그대로 돌려주는 것이 이 함수의 계약이다.** 호출부가
 * 1초마다 부르는 타이머라, 매번 새 배열을 만들면 아무도 입력하지 않는 동안에도 상태가
 * 갱신돼 채팅 화면 전체가 계속 다시 그려진다.
 */
export function pruneTyping(
  entries: readonly TypingEntry[],
  now: number,
): readonly TypingEntry[] {
  const alive = entries.filter((entry) => entry.expiresAt > now);
  return alive.length === entries.length ? entries : alive;
}

/**
 * 이 사람의 '입력 중'을 즉시 지운다 — 메시지가 도착했다는 건 다 쓰고 보냈다는 뜻이라
 * 만료를 기다릴 이유가 없다. 같은 이유로 참조 유지 계약도 지킨다.
 */
export function dropTyping(
  entries: readonly TypingEntry[],
  userId: string,
): readonly TypingEntry[] {
  const kept = entries.filter((entry) => entry.userId !== userId);
  return kept.length === entries.length ? entries : kept;
}

/**
 * '입력 중' 문구. 아무도 없으면 빈 문자열이다.
 *
 * 두 명 이상은 이름을 늘어놓지 않고 `외 N명`으로 접는다. 나열하면 조사(이/가)가 마지막
 * 이름의 받침에 따라 달라져 문장이 깨지는데, `외 N명이`는 늘 같은 조사로 끝난다.
 */
export function typingLabel(
  entries: readonly TypingEntry[],
  members: readonly PresentMember[],
): string {
  if (entries.length === 0) {
    return '';
  }
  const name = members.find((member) => member.id === entries[0].userId)?.name;
  const lead = name ? `${name}님` : UNKNOWN_TYPIST;
  if (entries.length === 1) {
    // '누군가 입력 중…' — 이름을 모를 때는 주격 조사를 붙이지 않는다.
    return name ? `${lead}이 입력 중…` : `${lead} 입력 중…`;
  }
  return `${lead} 외 ${entries.length - 1}명이 입력 중…`;
}
