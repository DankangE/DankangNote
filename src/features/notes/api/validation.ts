import { z } from '@/lib/zod';

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
] as const;

const MARK_TYPES = ['bold', 'italic', 'strike', 'code', 'underline'] as const;

const markSchema = z.object({ type: z.enum(MARK_TYPES) });

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
      start: z.number().int().min(1).optional(),
      language: z.string().max(50).nullish(),
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
