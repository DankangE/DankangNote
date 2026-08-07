// @vitest-environment happy-dom
// Tiptap의 HTML 파싱은 window/DOMParser를 쓴다 — 이 파일만 DOM 환경으로 돌린다(나머지
// 스위트는 node 환경 그대로다).
import { describe, expect, it } from 'vitest';
import { generateJSON } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { noteEditorExtensions } from './editor';
import { noteInputSchema } from './api/validation';

// 붙여넣기·드롭으로 들어오는 HTML은 이 확장 목록의 parseHTML이 해석한다 (KAN-38).
// 여기가 느슨하면 **에디터가 저장 불가능한 문서를 만든다** — zod가 doc 전체를 거부해
// 제목까지 저장이 막히는데, 사용자에게는 어느 블록이 문제인지 보이지 않는다.

function imagesIn(doc: JSONContent): JSONContent[] {
  const found: JSONContent[] = [];
  const stack: JSONContent[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'image') found.push(node);
    for (const child of node.content ?? []) stack.push(child);
  }
  return found;
}

const paste = (html: string) => generateJSON(html, noteEditorExtensions) as JSONContent;

describe('붙여넣은 이미지는 우리 첨부 라우트만 노드가 된다', () => {
  it('우리 첨부 라우트는 그대로 이미지 블록이 된다', () => {
    const doc = paste('<p>앞</p><img src="/api/notes/attachments/abc123">');
    expect(imagesIn(doc)).toHaveLength(1);
    expect(imagesIn(doc)[0].attrs?.src).toBe('/api/notes/attachments/abc123');
  });

  it.each([
    ['외부 http(s) URL', '<img src="https://example.com/a.png">'],
    ['프로토콜 상대 URL', '<img src="//evil.com/a.png">'],
    ['data: 인라인', '<img src="data:image/png;base64,AAAA">'],
    ['javascript: 스킴', '<img src="javascript:alert(1)">'],
    ['경로 탐색', '<img src="/api/notes/attachments/../../secret">'],
    ['다른 라우트', '<img src="/api/chat/attachments/abc123">'],
    ['쿼리 접미', '<img src="/api/notes/attachments/abc123?x=1">'],
    ['src 없음', '<img alt="빈">'],
  ])('%s는 노드가 되지 않는다', (_label, html) => {
    expect(imagesIn(paste(html))).toHaveLength(0);
  });

  it('본문 텍스트는 남기고 이미지만 떨군다 — 붙여넣기가 통째로 죽지 않는다', () => {
    const doc = paste('<p>공들여 쓴 본문</p><img src="https://example.com/a.png"><p>뒤</p>');
    expect(imagesIn(doc)).toHaveLength(0);
    expect(JSON.stringify(doc)).toContain('공들여 쓴 본문');
    expect(JSON.stringify(doc)).toContain('뒤');
  });
});

describe('에디터가 만든 문서는 항상 저장 가능하다 (에디터 ↔ zod 화이트리스트 정합)', () => {
  it('외부 이미지를 붙여넣어도 저장이 막히지 않는다 (회귀: KAN-38 자체 리뷰 ①)', () => {
    const doc = paste('<p>공들여 쓴 본문</p><img src="https://example.com/a.png">');
    const parsed = noteInputSchema.safeParse({ title: '멀쩡한 제목', content: doc });
    expect(parsed.success).toBe(true);
  });

  it('마크다운 이미지 문법은 입력 규칙이 없어 그냥 텍스트다', () => {
    const doc = paste('<p>![그림](https://example.com/a.png)</p>');
    expect(imagesIn(doc)).toHaveLength(0);
    const parsed = noteInputSchema.safeParse({ title: '제목', content: doc });
    expect(parsed.success).toBe(true);
  });

  it('KAN-38 블록(체크리스트·표)도 붙여넣기 후 저장 가능하다', () => {
    const doc = paste(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>할 일</p></li></ul>' +
        '<table><tbody><tr><th><p>머리</p></th><td><p>칸</p></td></tr></tbody></table>',
    );
    const parsed = noteInputSchema.safeParse({ title: '제목', content: doc });
    expect(parsed.success).toBe(true);
  });
});
