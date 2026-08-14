import { z } from '@/lib/zod';
import { isInlineImage, MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { NOTE_ATTACHMENT_SRC_RE } from '@/features/notes/attachments';
import { COMMENT_MARK, COMMENT_THREAD_ID_RE, MAX_COMMENT_BODY } from '@/features/notes/comments';
import {
  clampStart,
  clampSpan,
  normalizeAlignment,
  normalizeAltText,
  normalizeCodeLanguage,
  normalizeColwidth,
} from '@/features/notes/content-limits';

// 액션('use server')과 조회(server-only)가 공유하는 스키마 — 'use server' 모듈은
// async 함수만 export할 수 있어 스키마를 별도 모듈로 둔다.

// content는 Tiptap(ProseMirror) doc JSON이다(KAN-16). 임의 JSON을 그대로 저장/렌더하면
// 저장형 XSS가 되므로, 에디터가 만들 수 있는 노드/마크 타입만 화이트리스트로 허용하고
// 그 밖의 키(예: onclick, style)는 zod가 strip한다. link 마크는 editor.ts에서 비활성 —
// href 새니타이즈 경로가 없어 화이트리스트에서도 제외한다.
const NODE_TYPES = [
  'doc',
  'paragraph',
  'text',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  // KAN-38 블록 확장. 에디터(editor.ts) 확장과 함께 늘어난다 — 여기서 빠지면
  // 그 블록이 저장에서 조용히 잘린다(티켓 본문의 경고가 이 자리다).
  'taskList',
  'taskItem',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'image',
] as const;

// KAN-40에서 comment가 붙었다 — 인라인 코멘트의 앵커다. 노드 화이트리스트와 같은 규칙:
// 여기서 빠지면 그 마크가 저장에서 조용히 잘린다(= 코멘트가 본문에서 위치를 잃는다).
const MARK_TYPES = ['bold', 'italic', 'strike', 'code', 'underline', COMMENT_MARK] as const;

/**
 * 마크는 오래 attrs 없이 살았다(서식 마크는 전부 attr이 없다). comment가 처음으로 값을
 * 들고 오는데, **attrs를 안 적으면 zod object가 통째로 strip한다** — 마크는 남고 threadId만
 * 사라져 '어느 스레드인지 모르는 강조'가 저장된다. 노드 쪽 attr에서 여러 번 밟은 함정이
 * 마크에도 그대로 있다(KAN-38의 align이 같은 이유로 잘렸다).
 *
 * threadId는 형태만 본다 — **그 스레드가 실제로 이 노트의 것인지는 zod가 알 수 없다**
 * (DB를 봐야 한다). 그 판정은 저장 경로의 정규화가 맡고(note-sanitize.ts), 여기서는 우리가
 * 만든 적 없는 모양을 끊는 것까지다. 에디터의 parseHTML이 같은 정규식을 본다(규약 25).
 */
const markSchema = z.object({
  type: z.enum(MARK_TYPES),
  attrs: z
    .object({
      threadId: z.string().regex(COMMENT_THREAD_ID_RE).optional(),
    })
    .optional(),
});

// 노드는 자기 자신을 content로 포함하는 재귀 구조 — zod 4의 getter로 표현한다.
// attrs는 알려진 안전한 키만 남기고(zod object의 기본 strip) 나머지는 버린다.
// language가 nullish인 이유: Tiptap codeBlock은 getJSON 시 항상 attrs.language를
// 방출하고 기본값이 null이다 — nullable을 허용하지 않으면 코드블록 노트가 저장 불가.
const noteNodeSchema = z.object({
  type: z.enum(NODE_TYPES),
  text: z.string().optional(),
  attrs: z
    .object({
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      // **표시용 attr은 거부하지 않고 접는다** (KAN-72) — 이 블록에서 `src`를 뺀 전부가
      // 그렇다. 에디터 확장들의 parseHTML은 붙여넣은 HTML의 attr을 검증 없이 받는다:
      // `<ol start="0">`, `<td rowspan="0">`(유효한 HTML5다), `<td colwidth="auto">`
      // (parseInt → NaN), 긴 `language`·`alt`. 거부하면 그 블록 하나가 제목까지 포함한
      // doc 전체의 저장을 막고, 사용자는 어느 블록인지 알 수 없어 편집 세션을 통째로
      // 잃는다. 접어도 잃는 게 없으므로 검증을 **전역 함수로** 만들어 그 부류를 닫는다.
      // `src`만 반대다 — 접을 '가까운 올바른 값'이 없어 노드째 떨군다(에디터 parseHTML +
      // 아래 정규식). 새 attr을 더할 때 물을 것: 잘못된 값을 접을 수 있는가, 아니면
      // 그 노드가 통째로 무의미해지는가.
      start: z.unknown().transform(clampStart).optional(),
      language: z.unknown().transform(normalizeCodeLanguage).nullish(),
      // taskItem — getJSON이 항상 방출한다(기본 false).
      checked: z.boolean().optional(),
      // 표 셀. colwidth는 리사이즈를 껐어도 스키마 attr라 null로 방출된다(nullish 필수 —
      // codeBlock language와 같은 함정).
      colspan: z.unknown().transform(clampSpan).optional(),
      rowspan: z.unknown().transform(clampSpan).optional(),
      colwidth: z.unknown().transform(normalizeColwidth).nullish(),
      // 셀 정렬 — 화이트리스트에 없으면 zod가 strip해 붙여넣은 표의 정렬이 저장에서
      // 조용히 사라진다(KAN-38 티켓이 경고한 '조용히 잘린다'의 다른 얼굴).
      align: z.unknown().transform(normalizeAlignment).nullish(),
      // 이미지 src는 우리 첨부 라우트만 — 외부 URL·data:·javascript: 스킴이 저장형
      // XSS/추적 벡터가 되는 것을 형태 수준에서 끊는다(KAN-38). alt는 표시용 텍스트.
      src: z.string().regex(NOTE_ATTACHMENT_SRC_RE, '올바른 이미지 주소가 아닙니다.').optional(),
      // alt도 같은 부류다 — 붙여넣은 <img alt>는 길이 제한이 없는데 거부하면 그 이미지
      // 하나가 제목까지 포함한 저장 전체를 막는다. src만 거부한다(접을 값이 없으므로).
      alt: z.unknown().transform(normalizeAltText).nullish(),
    })
    .optional(),
  marks: z.array(markSchema).max(12).optional(),
  get content() {
    return z.array(noteNodeSchema).optional();
  },
});

const MAX_CONTENT_BYTES = 50_000;
const MAX_DEPTH = 100;
const MAX_NODES = 10_000;

// 재귀 zod 검증(safeParse) 이전에 깊이·노드 수를 반복적으로 선검사한다. 깊게 중첩된
// doc은 재귀 파서에서 스택 오버플로(RangeError)를 일으켜 검증 에러 대신 500이 되므로,
// 스택을 쓰지 않는 반복 순회로 한계를 먼저 건다(아래 pipe로 통과분만 재귀 검증).
function isContentWithinLimits(value: unknown): boolean {
  let count = 0;
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > MAX_DEPTH) return false;
    if ((count += 1) > MAX_NODES) return false;
    if (node && typeof node === 'object' && Array.isArray((node as { content?: unknown }).content)) {
      for (const child of (node as { content: unknown[] }).content) {
        // frontier도 제한 — 단일 노드의 거대한 content 배열이 push 도중 스택을
        // 부풀리지 못하게 한다(상류 body 제한에 의존하지 않음).
        if (stack.length > MAX_NODES) return false;
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }
  return true;
}

const noteDocSchema = noteNodeSchema
  .refine((node) => node.type === 'doc', { message: '올바른 문서 형식이 아닙니다.' })
  .refine((node) => JSON.stringify(node).length <= MAX_CONTENT_BYTES, {
    message: '본문이 너무 깁니다.',
  });

// 깊이 선검사(반복) → 통과분만 재귀 doc 스키마로. pipe는 앞 단계 실패 시 뒤 스키마를
// 실행하지 않으므로, 깊은 payload가 재귀 검증에 도달하지 않는다.
export const noteContentSchema = z
  .unknown()
  .refine(isContentWithinLimits, { message: '본문이 너무 깁니다.' })
  .pipe(noteDocSchema);

export const noteInputSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력하세요.').max(200, '제목은 200자 이하여야 합니다.'),
  content: noteContentSchema.optional(),
});

export const noteIdSchema = z.string().min(1, '노트 id가 필요합니다.');

// 인라인 코멘트 (KAN-40).
//
// threadId는 본문 마크와 **같은 정규식**을 본다 — 액션으로 들어오는 id와 본문에 저장되는
// id가 다른 규칙을 쓰면, 한쪽으로 만든 것을 다른 쪽이 못 알아보는 자리가 생긴다(규약 25).
export const commentThreadIdSchema = z
  .string()
  .regex(COMMENT_THREAD_ID_RE, '코멘트 스레드 id가 올바르지 않습니다.');
export const commentIdSchema = z.string().min(1, '코멘트 id가 필요합니다.');

// 코멘트 본문은 서식 없는 한 줄 텍스트다 — 본문 doc과 달리 마크·노드가 없어 zod 화이트리스트가
// 필요 없다. 렌더도 textContent로 하므로 저장형 XSS 표면이 아니다.
export const commentBodySchema = z
  .string()
  .trim()
  .min(1, '내용을 입력해주세요.')
  .max(MAX_COMMENT_BODY, `코멘트는 ${MAX_COMMENT_BODY}자를 넘을 수 없습니다.`);

// 생성 전용 — parentId는 update 스키마(partial)에 섞지 않는다. 부모 변경은 사이클
// 검사가 붙는 moveNote 경로만 쓴다(KAN-37).
export const createNoteInputSchema = noteInputSchema.extend({
  parentId: noteIdSchema.nullish(),
});

// 이동 대상 — index는 대상 형제 그룹 기준 삽입 위치. 상한은 서비스가 클램프하지만
// 터무니없는 값(1e9 등)이 정수 오버플로 없이 통과하지 않게 여기서도 자른다.
export const moveNoteTargetSchema = z.object({
  parentId: noteIdSchema.nullable(),
  index: z.number().int().min(0).max(100_000),
});

// 이미지 presign 입력 (KAN-38) — 노트 본문에는 인라인 안전 이미지 타입만 올린다.
// 크기·타입의 실제 강제는 스토리지 POST 정책이 한다(storage.ts) — 이건 이른 거절이다.
export const presignNoteImageSchema = z.object({
  fileName: z.string().trim().min(1, '파일 이름이 필요합니다.').max(200, '파일 이름이 너무 깁니다.'),
  contentType: z
    .string()
    .refine(isInlineImage, '이미지 파일(PNG·JPEG·GIF·WebP)만 넣을 수 있습니다.'),
  size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES, '10MB 이하만 올릴 수 있습니다.'),
});
