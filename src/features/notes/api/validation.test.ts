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
    expect(noteContentSchema.safeParse(img('javascript' + ':alert(1)')).success).toBe(false);
    expect(noteContentSchema.safeParse(img('data:image/png;base64,AAAA')).success).toBe(false);
    expect(
      noteContentSchema.safeParse(img('/api/notes/attachments/../../secret')).success,
    ).toBe(false);
  });

  const cell = (attrs: Record<string, unknown>) =>
    doc([
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableCell', attrs, content: [{ type: 'paragraph' }] }] },
        ],
      },
    ]);

  // KAN-72에서 판단이 바뀌었다: 거부 → 정규화. 이 값들은 표시용이라 경계로 접어도 잃는 게
  // 없는 반면, 거부하면 그 셀 하나가 제목까지 포함한 doc 전체의 저장을 막는다. 붙여넣은
  // HTML에는 `rowspan="0"`(유효한 HTML5)·`colwidth="auto"`가 실제로 들어온다.
  it('경계 밖 셀 병합 값은 거부하지 않고 범위 안으로 접는다', () => {
    const parsed = noteContentSchema.safeParse(
      cell({ colspan: 0, rowspan: 300, colwidth: ['auto', 99_999] }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const td = parsed.data.content?.[0].content?.[0].content?.[0];
    // colwidth는 위치로 읽히므로 잘못된 칸을 **버리지 않고** 0(미지정)으로 둔다 — 버리면
    // 뒤 너비가 한 칸씩 앞으로 밀려 엉뚱한 열에 붙는다.
    expect(td?.attrs).toMatchObject({ colspan: 1, rowspan: 100, colwidth: [0, 10_000] });
  });

  // zod transform 안에서 던지면 safeParse가 throw하고, parseOrError는 guarded 밖이라
  // Server Action이 그대로 500이 된다 — 이 PR이 없애려던 바로 그 실패 모드다.
  it('악의적인 attr 값에도 safeParse가 던지지 않는다', () => {
    let nested: unknown = [];
    for (let i = 0; i < 4000; i++) nested = [nested];
    const hostile: unknown[] = [
      nested,
      { toString() { throw new Error('boom'); } },
      { valueOf() { throw new Error('boom'); } },
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e308,
      Symbol('x'),
      () => 1,
    ];
    for (const value of hostile) {
      for (const key of ['start', 'colspan', 'rowspan', 'colwidth']) {
        expect(() => noteContentSchema.safeParse(cell({ [key]: value }))).not.toThrow();
      }
    }
  });

  it('정상 범위의 셀 병합 값은 그대로 통과한다', () => {
    const parsed = noteContentSchema.safeParse(
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 2, rowspan: 3, colwidth: [120] },
                  content: [{ type: 'paragraph' }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.content?.[0].content?.[0].content?.[0]?.attrs).toMatchObject({
      colspan: 2,
      rowspan: 3,
      colwidth: [120],
    });
  });
});
