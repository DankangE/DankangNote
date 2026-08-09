// Pusher 프레즌스 멤버의 순수 상태 계산 (KAN-34에서 만들고 KAN-75에서 옮겼다).
//
// 채팅 채널과 문서 편집 채널이 같은 모양을 쓴다 — 여기 있는 건 '누가 이 채널을 열어 두고
// 있는가'이지 채팅의 규칙이 아니다. 두 벌로 두면 이름 해석·정렬 같은 사소한 규칙이 갈라져
// 한쪽에서만 아바타 줄이 흔들리는 식으로 어긋난다.

/** 지금 이 채널을 열어 두고 있는 사람. name·imageUrl은 채널 인증이 실어 보낸 표시 정보다. */
export type PresentMember = {
  id: string;
  name: string;
  imageUrl: string | null;
};

// pusher-js가 프레즌스 이벤트에 싣는 모양. 라이브러리 타입이 느슨해(members: any) 여기서
// 필요한 만큼만 적어 두고, 값이 정말 그런지는 presentMember가 다시 본다.
export type PusherMember = { id: unknown; info: unknown } | null;
export type PusherMembers = {
  each: (visit: (member: PusherMember) => void) => void;
  /** 나. 구독이 성립할 때만 채워진다. */
  me?: PusherMember;
};

/**
 * Pusher가 클라이언트 이벤트에 붙여 주는 메타데이터. `user_id`는 **구독 인증 서명에서
 * 나온 값**이라 보낸 쪽이 바꿀 수 없다 — 클라이언트 이벤트에서 신원의 유일한 근거다.
 */
export type PusherEventMetadata = { user_id?: unknown } | undefined;

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
