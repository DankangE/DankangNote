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
/** 상한도 둔다 — 없으면 1e308 같은 값이 DB까지 그대로 간다(어떤 에디터도 못 만드는 값이다). */
export const ORDERED_LIST_START_MAX = 1_000_000;

/** 코드블록 언어 이름 — `class="language-…"`에서 온다. 표시용이라 길이만 막으면 된다. */
export const CODE_LANGUAGE_MAX_LEN = 50;

/** 이미지 대체 텍스트. 붙여넣은 `<img alt>`는 길이 제한이 없다 — 역시 표시용이라 자른다. */
export const IMAGE_ALT_MAX_LEN = 300;

/** 표 셀 정렬 — @tiptap/extension-table이 style.text-align·align에서 뽑아 이 셋으로 정규화한다. */
export const TABLE_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type TableAlignment = (typeof TABLE_ALIGNMENTS)[number];

/** 표 셀 병합 수. HTML5는 `rowspan="0"`('남은 행 전부')을 허용하지만 우리 스키마는 1 이상. */
export const TABLE_SPAN_MIN = 1;
export const TABLE_SPAN_MAX = 100;

/** 열 너비(px). 리사이즈는 껐지만 붙여넣은 표가 값을 들고 올 수 있다. */
export const TABLE_COLWIDTH_MIN = 1;
export const TABLE_COLWIDTH_MAX = 10_000;
/** 한 셀의 colwidth 배열 길이 상한 — 거대한 배열이 메모리를 먹지 않게. */
export const TABLE_COLWIDTH_MAX_LEN = 100;
/**
 * prosemirror-tables가 '너비 미지정'을 나타내는 값. `setColumnWidth`가 `zeroes(colspan)`으로
 * 배열을 깔기 때문에, 리사이즈를 켠 에디터에서 복사한 표는 `colwidth="0,150"` 형태로 온다.
 * 이걸 1로 접으면 그 칸이 '명시적으로 25px'로 취급돼 표가 칸마다 24px씩 좁아진다.
 */
export const TABLE_COLWIDTH_UNSET = 0;

/**
 * **전역 함수여야 한다** — zod transform 안에서 돌고, zod는 ZodError가 아닌 throw를 잡지
 * 않는다. `parseOrError`는 `guarded` 밖에 있으므로 여기서 던지면 Server Action이 그대로
 * 500이 된다(KAN-72 자체 리뷰). 그래서 `String(raw)`를 쓰지 않는다: 배열에 대한 `String()`은
 * `Array.prototype.toString → join → toString`으로 재귀해 중첩 배열에서 스택을 터뜨리고,
 * 임의 객체의 `toString`/`valueOf`는 사용자 코드라 던질 수 있다. 타입을 좁혀서 받는다.
 */
function toInt(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.trunc(raw) : null;
  if (typeof raw !== 'string') return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** `undefined`는 그대로 둔다 — attr이 없는 것과 잘못된 것은 다르다(없으면 노드 기본값). */
export function clampStart(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parsed = toInt(raw);
  if (parsed === null) return ORDERED_LIST_START_MIN;
  return clamp(parsed, ORDERED_LIST_START_MIN, ORDERED_LIST_START_MAX);
}

export function clampSpan(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parsed = toInt(raw);
  if (parsed === null) return TABLE_SPAN_MIN;
  return clamp(parsed, TABLE_SPAN_MIN, TABLE_SPAN_MAX);
}

/**
 * colwidth는 **위치로 읽힌다** — prosemirror-tables의 `updateColumns`가 `colwidth[j]`로
 * j번째 열을 집는다. 그래서 잘못된 칸을 **버리면 안 된다**: 버리는 순간 뒤 너비들이 한 칸씩
 * 앞으로 밀려 엉뚱한 열에 붙는다(`['auto', 150]`을 `[150]`으로 접으면 0번 열이 1번 열의
 * 너비를 갖는다). 자리를 지키고 값만 '미지정'(0)으로 바꾼다.
 *
 * 전부 미지정이면 null을 준다 — 배열 자체가 없는 것과 같은 뜻이고, 그게 스키마 기본 상태다.
 */
export function normalizeColwidth(raw: unknown): number[] | null {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? // split의 limit으로 자른다 — 거대한 문자열이 slice 전에 통째로 배열이 되지 않게.
        raw.split(',', TABLE_COLWIDTH_MAX_LEN)
      : null;
  if (!source) return null;
  const widths = source.slice(0, TABLE_COLWIDTH_MAX_LEN).map((value) => {
    const parsed = toInt(value);
    if (parsed === null || parsed <= TABLE_COLWIDTH_UNSET) return TABLE_COLWIDTH_UNSET;
    return clamp(parsed, TABLE_COLWIDTH_MIN, TABLE_COLWIDTH_MAX);
  });
  return widths.some((value) => value !== TABLE_COLWIDTH_UNSET) ? widths : null;
}

/** 과길이는 자른다 — 표시용 값이라 절삭으로 잃는 게 없다. */
export function normalizeCodeLanguage(raw: unknown): string | null {
  return truncateOrNull(raw, CODE_LANGUAGE_MAX_LEN);
}

/** alt도 같은 이유로 자른다 — 거부하면 그 이미지 하나가 문서 전체의 저장을 막는다. */
export function normalizeAltText(raw: unknown): string | null {
  return truncateOrNull(raw, IMAGE_ALT_MAX_LEN);
}

/** 표 셀 정렬. 아는 값이 아니면 null(정렬 없음) — 거부하지 않는다. */
export function normalizeAlignment(raw: unknown): TableAlignment | null {
  return TABLE_ALIGNMENTS.includes(raw as TableAlignment) ? (raw as TableAlignment) : null;
}

/** `typeof` 가드가 먼저다 — String(raw)는 중첩 배열·악의적 toString에서 던진다(toInt 주석). */
function truncateOrNull(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw.slice(0, maxLen);
}
