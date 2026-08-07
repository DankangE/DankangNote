// 본문 노드 attr의 허용 범위와 그 정규화 (KAN-72).
//
// 규약 25("에디터가 만들 수 있는 것과 스키마가 받는 것은 같아야 한다")를 숫자·문자열
// attr에 적용한 것. 다만 이미지 src와 방식이 다르다:
//
//   src   — 접을 '가까운 올바른 값'이 없다 → 에디터 parseHTML이 노드째 떨구고 zod도 거부.
//   나머지 — 전부 표시용이라 경계로 접어도 잃는 게 없다 → **zod가 거부 대신 정규화**한다.
//
// 정규화를 택하면 검증이 이 attr들에 대해 전역 함수(total)가 되므로, 에디터가 무엇을
// 만들든 저장이 막히지 않는다. 확장 수술이 필요 없고, 액션에 raw JSON을 직접 POST하는
// 경로까지 같은 규칙으로 덮인다. 거부했을 때의 대가는 크다 — zod는 doc **전체**를 물리므로
// 블록 하나가 제목까지 포함한 저장을 막고, 사용자는 어느 블록인지 알 수 없다.
//
// 별도 모듈인 이유는 attachments.ts와 같다(순환 회피): content.ts가 validation.ts를
// import하므로 validation이 쓸 상수를 content에 둘 수 없다.

/** 순서목록 시작 번호. HTML `<ol start>`는 0·음수를 허용하지만 ProseMirror 목록은 1부터다. */
export const ORDERED_LIST_START_MIN = 1;

/** 코드블록 언어 이름 — `class="language-…"`에서 온다. 표시용이라 길이만 막으면 된다. */
export const CODE_LANGUAGE_MAX_LEN = 50;

/** 표 셀 병합 수. HTML5는 `rowspan="0"`('남은 행 전부')을 허용하지만 우리 스키마는 1 이상. */
export const TABLE_SPAN_MIN = 1;
export const TABLE_SPAN_MAX = 100;

/** 열 너비(px). 리사이즈는 껐지만 붙여넣은 표가 값을 들고 올 수 있다. */
export const TABLE_COLWIDTH_MIN = 1;
export const TABLE_COLWIDTH_MAX = 10_000;
/** 한 셀의 colwidth 배열 길이 상한 — 거대한 배열이 메모리를 먹지 않게. */
export const TABLE_COLWIDTH_MAX_LEN = 100;

function toInt(raw: unknown): number | null {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** `undefined`는 그대로 둔다 — attr이 없는 것과 잘못된 것은 다르다(없으면 노드 기본값). */
export function clampStart(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parsed = toInt(raw);
  if (parsed === null) return ORDERED_LIST_START_MIN;
  return Math.max(ORDERED_LIST_START_MIN, parsed);
}

export function clampSpan(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parsed = toInt(raw);
  if (parsed === null) return TABLE_SPAN_MIN;
  return clamp(parsed, TABLE_SPAN_MIN, TABLE_SPAN_MAX);
}

/** 숫자가 아닌 칸은 버린다. 전부 버려지면 null = '지정 없음'(스키마의 기본 상태). */
export function normalizeColwidth(raw: unknown): number[] | null {
  const source = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null;
  if (!source) return null;
  const widths = source
    .slice(0, TABLE_COLWIDTH_MAX_LEN)
    .map(toInt)
    .filter((value): value is number => value !== null)
    .map((value) => clamp(value, TABLE_COLWIDTH_MIN, TABLE_COLWIDTH_MAX));
  return widths.length > 0 ? widths : null;
}

/** 과길이는 자른다 — 표시용 값이라 절삭으로 잃는 게 없다. */
export function normalizeCodeLanguage(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw.slice(0, CODE_LANGUAGE_MAX_LEN);
}
