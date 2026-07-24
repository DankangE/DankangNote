import type { JSONContent } from '@tiptap/core';
import { noteContentSchema } from '@/features/notes/api/validation';

// Tiptap 기본 빈 상태 = 빈 문단 하나. 저장 시엔 '' 센티넬로 바꾼다(serializeNoteContent).
export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

// 빈 노트 판정: 내용이 없거나 빈 문단 하나뿐. hr·코드블록 등 텍스트 없는 콘텐츠는
// '비어있음'으로 보지 않아 저장에서 유실되지 않게 한다.
export function isDocEmpty(doc: JSONContent): boolean {
  const content = doc.content ?? [];
  if (content.length === 0) return true;
  if (content.length === 1) {
    const [only] = content;
    return only.type === 'paragraph' && (only.content?.length ?? 0) === 0;
  }
  return false;
}

// 저장 형태(문자열). 빈 doc은 기존 컬럼 기본값('')과 똑같이 저장해 legacy 노트와
// 표현을 맞춘다. 그 외에는 doc JSON을 직렬화한다.
export function serializeNoteContent(doc: JSONContent): string {
  return isDocEmpty(doc) ? '' : JSON.stringify(doc);
}

// 저장 문자열 → 에디터/렌더용 doc. 세 경우를 모두 문단 doc으로 흡수한다:
// 빈 문자열, legacy plain 텍스트(JSON 아님), 스키마에 맞지 않는 JSON.
export function parseNoteContent(raw: string): JSONContent {
  if (!raw) return structuredClone(EMPTY_DOC);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return plainTextToDoc(raw);
  }
  // 성공 시 raw가 아니라 zod 출력을 반환한다 — 저장 경로가 이미 새니타이즈하지만,
  // 만약 오염된 doc이 저장돼 있어도 읽기에서 화이트리스트 밖 키를 한 번 더 strip한다.
  const result = noteContentSchema.safeParse(parsed);
  return result.success ? result.data : plainTextToDoc(raw);
}

// legacy plain 텍스트를 문단 doc으로. 빈 줄 2개 이상을 문단 경계로 본다.
export function plainTextToDoc(text: string): JSONContent {
  const paragraphs: JSONContent[] = text.split(/\n{2,}/).map((block) =>
    block.length > 0
      ? { type: 'paragraph', content: [{ type: 'text', text: block }] }
      : { type: 'paragraph' },
  );
  return { type: 'doc', content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }] };
}

// 렌더 폴백용 순수 텍스트 추출(블록 구분은 잃는다). raw HTML을 절대 만들지 않는다.
export function docToPlainText(doc: JSONContent): string {
  const parts: string[] = [];
  const walk = (node: JSONContent) => {
    if (typeof node.text === 'string') parts.push(node.text);
    node.content?.forEach(walk);
  };
  walk(doc);
  return parts.join('');
}
