// 멘션의 표기 규칙과 검증 (KAN-32). 서버(전송 검증)와 클라이언트(컴포저·렌더러)가
// 공유하는 순수 로직이라 server-only를 붙이지 않는다.

/** 채널 전체를 부르는 이름. 개인 이름과 겹치지 않도록 예약어로 둔다. */
export const CHANNEL_MENTION = 'channel';

export type MentionKind = 'user' | 'channel';

/**
 * 본문 안의 멘션 한 건. start/length는 body의 **코드 유닛** 기준이다
 * (JS 문자열 인덱스 그대로 — 렌더러가 slice로 자르므로 코드 포인트로 세면 어긋난다).
 */
export type MentionSpan = {
  kind: MentionKind;
  /** kind가 'user'일 때만 있다. */
  userId: string | null;
  start: number;
  length: number;
};

/** 멘션이 본문에 쓰이는 모양. 컴포저가 넣는 문자열이자 검증의 기준이다. */
export function mentionText(label: string): string {
  return `@${label}`;
}

/**
 * 이 스팬이 정말 본문의 그 자리에 그 이름으로 적혀 있는지.
 *
 * 서버가 클라이언트의 주장을 그대로 믿지 않기 위한 검증이다 — 없으면 "안녕하세요"라는
 * 본문에 임의의 userId를 실어 아무나 호출하는 알림 스팸이 된다. 라벨은 서버가 미러에서
 * 다시 읽은 표시 이름이라, 클라이언트가 이름까지 지어낼 수는 없다.
 */
export function spanMatches(body: string, span: MentionSpan, label: string): boolean {
  if (span.start < 0 || span.length <= 0 || span.start + span.length > body.length) {
    return false;
  }
  return body.slice(span.start, span.start + span.length) === mentionText(label);
}

/** 두 스팬이 본문에서 겹치는지 — 겹친 멘션은 렌더러가 자를 수 없다. */
function overlaps(a: MentionSpan, b: MentionSpan): boolean {
  return a.start < b.start + b.length && b.start < a.start + a.length;
}

/**
 * 스팬들을 시작 위치 순으로 정렬하고 겹치는 것을 버린다.
 * 렌더러는 이 순서를 전제로 본문을 한 번만 훑는다.
 */
export function normalizeSpans(spans: MentionSpan[]): MentionSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const kept: MentionSpan[] = [];
  for (const span of sorted) {
    const last = kept[kept.length - 1];
    if (!last || !overlaps(last, span)) {
      kept.push(span);
    }
  }
  return kept;
}

/** 컴포저가 고른 멘션 하나 — 아직 본문 어디에 있는지는 정하지 않았다. */
export type PickedMention = {
  kind: MentionKind;
  userId: string | null;
  /** 본문에 `@라벨`로 적히는 이름. */
  label: string;
};

/**
 * 고른 멘션들이 지금 본문의 **어디에** 있는지 찾아 스팬으로 만든다.
 *
 * 입력하는 내내 위치를 따라다니며 갱신하지 않는 이유다: 앞쪽을 고치거나 붙여넣기 한 번이면
 * 모든 스팬이 밀리고, 그 보정을 놓치면 엉뚱한 구간이 멘션으로 굳는다. 보낼 때 한 번
 * 본문에서 다시 찾으면 그 사이 무슨 편집이 있었든 정확하고, 지워진 멘션은 자연히 빠진다.
 *
 * 같은 사람을 두 번 골랐으면 서로 다른 occurrence를 하나씩 집는다(이미 쓴 자리는 건너뛴다).
 *
 * **긴 라벨부터 자리를 잡는다.** 한 이름이 다른 이름의 접두사이면(`단` / `단 강`) 짧은
 * 쪽이 긴 쪽 안쪽에 매칭돼 자리를 먼저 차지한다 — 그러면 본문에 이름이 적힌 `단 강`은
 * 알림을 못 받고, 본문에 나오지도 않는 `단`이 받는다. picked는 삽입한 텍스트를 지워도
 * 정리되지 않으므로(보낼 때 한 번에 찾는 설계의 대가) 실제로 일어난다.
 */
export function spansForPicked(body: string, picked: PickedMention[]): MentionSpan[] {
  const spans: MentionSpan[] = [];
  const byLongestLabel = [...picked].sort((a, b) => b.label.length - a.label.length);
  for (const pick of byLongestLabel) {
    const needle = mentionText(pick.label);
    let from = 0;
    for (;;) {
      const at = body.indexOf(needle, from);
      if (at < 0) {
        break;
      }
      if (!spans.some((span) => span.start === at)) {
        spans.push({ kind: pick.kind, userId: pick.userId, start: at, length: needle.length });
        break;
      }
      from = at + 1;
    }
  }
  return normalizeSpans(spans);
}

/** 렌더러가 받는 조각 — 일반 텍스트와 멘션이 번갈아 나온다. */
export type BodyPart =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; kind: MentionKind; userId: string | null };

/**
 * 본문을 스팬 기준으로 자른다. 본문에서 `@이름`을 **다시 찾지 않는** 것이 핵심이다 —
 * 정규식으로 재파싱하면 이름에 공백이 있을 때 어디까지가 이름인지 알 수 없고, 같은
 * 문자열이 본문 다른 곳에 있으면 엉뚱한 데가 강조된다.
 */
export function splitBody(body: string, spans: MentionSpan[]): BodyPart[] {
  const parts: BodyPart[] = [];
  let cursor = 0;
  for (const span of normalizeSpans(spans)) {
    // 스팬이 본문 밖을 가리키면(있어선 안 되지만 DB에 남은 옛 행일 수 있다) 건너뛴다.
    if (span.start < cursor || span.start + span.length > body.length) {
      continue;
    }
    if (span.start > cursor) {
      parts.push({ type: 'text', text: body.slice(cursor, span.start) });
    }
    parts.push({
      type: 'mention',
      text: body.slice(span.start, span.start + span.length),
      kind: span.kind,
      userId: span.userId,
    });
    cursor = span.start + span.length;
  }
  if (cursor < body.length) {
    parts.push({ type: 'text', text: body.slice(cursor) });
  }
  return parts;
}
