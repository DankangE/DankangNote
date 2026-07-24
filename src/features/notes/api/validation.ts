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
export const noteNodeSchema = z.object({
  type: z.enum(NODE_TYPES),
  text: z.string().optional(),
  attrs: z
    .object({
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      start: z.number().int().min(1).optional(),
      language: z.string().max(50).optional(),
    })
    .optional(),
  marks: z.array(markSchema).max(12).optional(),
  get content() {
    return z.array(noteNodeSchema).optional();
  },
});

export type NoteDoc = z.infer<typeof noteNodeSchema>;

// 직렬화 크기 상한 — 기존 plain 텍스트 제한(50KB)과 같은 선. 과대 doc을 막는다.
// 깊은 중첩에 대한 추가 하드닝은 후속 과제(현재는 크기 기준).
const MAX_CONTENT_BYTES = 50_000;

export const noteContentSchema = noteNodeSchema
  .refine((node) => node.type === 'doc', { message: '올바른 문서 형식이 아닙니다.' })
  .refine((node) => JSON.stringify(node).length <= MAX_CONTENT_BYTES, {
    message: '본문이 너무 깁니다.',
  });

export const noteInputSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력하세요.').max(200, '제목은 200자 이하여야 합니다.'),
  content: noteContentSchema.optional(),
});

export const noteIdSchema = z.string().min(1, '노트 id가 필요합니다.');
