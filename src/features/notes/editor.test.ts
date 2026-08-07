// @vitest-environment happy-dom
// Tiptap의 HTML 파싱은 window/DOMParser를 쓴다 — 이 파일만 DOM 환경으로 돌린다(나머지
// 스위트는 node 환경 그대로다).
import { describe, expect, it } from 'vitest';
import { generateJSON } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { noteEditorExtensions } from './editor';
import { noteInputSchema } from './api/validation';
import {
  clampStart,
  CODE_LANGUAGE_MAX_LEN,
  normalizeColwidth,
  ORDERED_LIST_START_MAX,
  ORDERED_LIST_START_MIN,
  TABLE_COLWIDTH_UNSET,
  TABLE_SPAN_MAX,
  TABLE_SPAN_MIN,
} from './content-limits';

// 붙여넣기·드롭으로 들어오는 HTML은 이 확장 목록의 parseHTML이 해석한다 (KAN-38).
// 여기가 느슨하면 **에디터가 저장 불가능한 문서를 만든다** — zod가 doc 전체를 거부해
// 제목까지 저장이 막히는데, 사용자에게는 어느 블록이 문제인지 보이지 않는다.

/** 문서 순서로 모은다 — 자식을 역순으로 쌓아야 pop()이 앞에서부터 나온다. */
function nodesOfType(doc: JSONContent, type: string): JSONContent[] {
  const found: JSONContent[] = [];
  const stack: JSONContent[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === type) found.push(node);
    const children = node.content ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return found;
}

const imagesIn = (doc: JSONContent) => nodesOfType(doc, 'image');

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

// KAN-72 — 이미지 src는 '떨구기'로 닫았지만, 같은 부류(에디터가 저장 불가능한 문서를
// 만든다)가 숫자·문자열 attr에 5개 더 남아 있었다. 이쪽은 접을 '가까운 올바른 값'이
// 있으므로 zod가 거부 대신 정규화한다 — 검증이 전역 함수가 되어 부류가 닫힌다.
describe('붙여넣은 attr이 범위를 벗어나도 저장은 막히지 않는다 (KAN-72)', () => {
  const save = (html: string) => noteInputSchema.safeParse({ title: '제목', content: paste(html) });
  const cell = (attr: string) =>
    `<table><tbody><tr><td ${attr}><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>`;

  it.each([
    ['ol start=0 (HTML은 허용, ProseMirror 목록은 1부터)', '<ol start="0"><li><p>a</p></li></ol>'],
    ['td rowspan=0 (유효한 HTML5 — 남은 행 전부)', cell('rowspan="0"')],
    ['td colwidth=auto (parseInt → NaN)', cell('colwidth="auto"')],
    ['td colwidth=99999 (상한 밖)', cell('colwidth="99999"')],
    ['td colspan=300 (상한 밖)', cell('colspan="300"')],
    [
      'code language 60자 (상한 밖)',
      '<pre><code class="language-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx">c</code></pre>',
    ],
  ])('%s — 저장된다', (_label, html) => {
    expect(save(html).success).toBe(true);
  });

  // 통과만 해서는 부족하다 — 실제로 범위 안 값으로 접혔는지까지 본다.
  it('접힌 값이 스키마 범위 안이다', () => {
    const parsed = save(cell('colspan="300" rowspan="0" colwidth="auto"'));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const td = nodesOfType(parsed.data.content as JSONContent, 'tableCell')[0];
    expect(td.attrs).toMatchObject({ colspan: TABLE_SPAN_MAX, rowspan: TABLE_SPAN_MIN, colwidth: null });
  });

  it('정상 값은 그대로 보존된다 (접기가 멀쩡한 문서를 망가뜨리지 않는다)', () => {
    const ol = save('<ol start="3"><li><p>a</p></li></ol>');
    expect(ol.success && nodesOfType(ol.data.content as JSONContent, 'orderedList')[0].attrs?.start).toBe(3);

    const code = save('<pre><code class="language-ts">c</code></pre>');
    expect(code.success && nodesOfType(code.data.content as JSONContent, 'codeBlock')[0].attrs?.language).toBe('ts');

    const td = save(cell('colspan="2"'));
    expect(td.success && nodesOfType(td.data.content as JSONContent, 'tableCell')[0].attrs?.colspan).toBe(2);
  });
});

// 접기가 실제로 일어나는지는 attr 값으로만 확인된다 — `success === true`는 zod가
// z.unknown()을 받으므로 정규화를 통째로 지워도 참이다 (KAN-72 자체 리뷰 ③).
describe('접기가 값 수준에서 일어난다 (5벡터 전부)', () => {
  const parseAttrs = (doc: JSONContent, type: string) => {
    const parsed = noteInputSchema.safeParse({ title: '제목', content: doc });
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    return nodesOfType(parsed.data.content as JSONContent, type)[0]?.attrs;
  };
  const cellDoc = (attr: string) =>
    paste(`<table><tbody><tr><td ${attr}><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>`);

  it('start — 0은 1로 접히고 상한도 있다', () => {
    expect(parseAttrs(paste('<ol start="0"><li><p>a</p></li></ol>'), 'orderedList')?.start).toBe(
      ORDERED_LIST_START_MIN,
    );
    expect(
      noteInputSchema.safeParse({
        title: '제목',
        content: { type: 'doc', content: [{ type: 'orderedList', attrs: { start: 1e308 } }] },
      }),
    ).toMatchObject({ success: true });
    expect(clampStart(1e308)).toBe(ORDERED_LIST_START_MAX);
    expect(clampStart(-5)).toBe(ORDERED_LIST_START_MIN);
  });

  it('language — 상한 길이로 잘린다', () => {
    const long = 'x'.repeat(200);
    const attrs = parseAttrs(paste(`<pre><code class="language-${long}">c</code></pre>`), 'codeBlock');
    expect((attrs?.language as string).length).toBe(CODE_LANGUAGE_MAX_LEN);
  });

  it('colspan·rowspan — 경계로 접힌다', () => {
    expect(parseAttrs(cellDoc('colspan="300"'), 'tableCell')?.colspan).toBe(TABLE_SPAN_MAX);
    expect(parseAttrs(cellDoc('rowspan="0"'), 'tableCell')?.rowspan).toBe(TABLE_SPAN_MIN);
  });

  it('colwidth — 자리를 지키고 값만 미지정으로 바꾼다 (버리면 뒤 너비가 밀린다)', () => {
    expect(normalizeColwidth(['auto', 150])).toEqual([TABLE_COLWIDTH_UNSET, 150]);
    // 0은 prosemirror-tables의 '미지정' 센티넬이다 — 1로 접으면 그 열이 25px로 굳는다.
    expect(normalizeColwidth([0, 150])).toEqual([TABLE_COLWIDTH_UNSET, 150]);
    expect(normalizeColwidth(['auto'])).toBeNull();
  });

  it('정규화는 멱등이다 — 저장·재열기·재저장이 값을 흔들지 않는다', () => {
    const once = normalizeColwidth(['auto', 99_999, 150]);
    expect(normalizeColwidth(once)).toEqual(once);
    expect(clampStart(clampStart(0))).toBe(clampStart(0));
  });
});
