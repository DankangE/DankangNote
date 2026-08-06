import { describe, expect, it } from 'vitest';
import { noteContentSchema } from './validation';

// zod 화이트리스트가 에디터 확장(KAN-38)과 함께 늘었는지 고정한다 — 여기서 빠진 블록은
// 저장에서 조용히 잘린다(티켓의 경고). 새 블록을 editor.ts에 더할 때 이 파일도 함께 는다.

const doc = (content: unknown[]) => ({ type: 'doc', content });

describe('noteContentSchema — KAN-38 블록', () => {
  it('체크리스트(taskList/taskItem·checked)를 통과시킨다', () => {
    const result = noteContentSchema.safeParse(
      doc([
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '할 일' }] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '남은 일' }] }],
            },
          ],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('표(헤더·colspan·rowspan·colwidth null)를 통과시킨다', () => {
    const cell = (type: string, text: string, attrs = {}) => ({
      type,
      attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const result = noteContentSchema.safeParse(
      doc([
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('tableHeader', '이름'), cell('tableHeader', '값')] },
            { type: 'tableRow', content: [cell('tableCell', 'a', { colspan: 2 }), cell('tableCell', 'b')] },
          ],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('화이트리스트 밖 노드 타입은 거부한다', () => {
    expect(noteContentSchema.safeParse(doc([{ type: 'iframe' }])).success).toBe(false);
  });

  it('알 수 없는 attrs 키는 벗겨낸다 (onclick 등)', () => {
    const result = noteContentSchema.safeParse(
      doc([
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false, onclick: 'alert(1)' },
              content: [{ type: 'paragraph' }],
            },
          ],
        },
      ]),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const item = (result.data.content?.[0]?.content ?? [])[0];
      expect(item?.attrs).toEqual({ checked: false });
    }
  });

  it('이미지 src는 우리 첨부 라우트만 통과한다', () => {
    const img = (src: string) => doc([{ type: 'image', attrs: { src, alt: null } }]);
    expect(noteContentSchema.safeParse(img('/api/notes/attachments/cabc123')).success).toBe(true);
    expect(noteContentSchema.safeParse(img('https://evil.example/x.png')).success).toBe(false);
    // eslint-disable-next-line no-script-url
    expect(noteContentSchema.safeParse(img('javascript:alert(1)')).success).toBe(false);
    expect(noteContentSchema.safeParse(img('data:image/png;base64,AAAA')).success).toBe(false);
    expect(
      noteContentSchema.safeParse(img('/api/notes/attachments/../../secret')).success,
    ).toBe(false);
  });

  it('경계 밖 셀 병합 값은 거부한다', () => {
    const bad = doc([
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', attrs: { colspan: 0 }, content: [{ type: 'paragraph' }] },
            ],
          },
        ],
      },
    ]);
    expect(noteContentSchema.safeParse(bad).success).toBe(false);
  });
});
