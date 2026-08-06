'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import { cn } from '@/lib/utils';

// 슬래시 커맨드 (KAN-38) — '/'로 블록 삽입 메뉴를 연다. 툴바와 같은 명령의 다른 입구라
// 명령 정의는 여기 목록 하나로 모은다. 메뉴는 ReactRenderer + fixed 포지셔닝 — tippy 같은
// 의존성을 더하지 않는다(프로젝트에 이미 있는 것으로 해결, general.md).

interface SlashItem {
  key: string;
  label: string;
  /** 검색 별칭 — 한글 라벨 외에 h1·todo·table 같은 입력도 잡는다. */
  aliases: string[];
  run: (editor: Editor, range: Range) => void;
}

const block = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

const SLASH_ITEMS: SlashItem[] = [
  { key: 'h1', label: '제목 1', aliases: ['h1', 'heading1'], run: (e, r) => block(e, r).setNode('heading', { level: 1 }).run() },
  { key: 'h2', label: '제목 2', aliases: ['h2', 'heading2'], run: (e, r) => block(e, r).setNode('heading', { level: 2 }).run() },
  { key: 'h3', label: '제목 3', aliases: ['h3', 'heading3'], run: (e, r) => block(e, r).setNode('heading', { level: 3 }).run() },
  { key: 'bullet', label: '글머리 목록', aliases: ['ul', 'bullet', 'list'], run: (e, r) => block(e, r).toggleBulletList().run() },
  { key: 'ordered', label: '번호 목록', aliases: ['ol', 'ordered', 'number'], run: (e, r) => block(e, r).toggleOrderedList().run() },
  { key: 'task', label: '체크리스트', aliases: ['todo', 'task', 'check'], run: (e, r) => block(e, r).toggleTaskList().run() },
  { key: 'quote', label: '인용', aliases: ['quote', 'blockquote'], run: (e, r) => block(e, r).toggleBlockquote().run() },
  { key: 'code', label: '코드 블록', aliases: ['code', 'codeblock'], run: (e, r) => block(e, r).toggleCodeBlock().run() },
  { key: 'hr', label: '구분선', aliases: ['hr', 'divider', 'rule'], run: (e, r) => block(e, r).setHorizontalRule().run() },
  { key: 'table', label: '표', aliases: ['table'], run: (e, r) => block(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
];

function filterItems(editor: Editor, query: string, pickImage: (() => void) | null): SlashItem[] {
  const items = pickImage
    ? [
        ...SLASH_ITEMS,
        {
          key: 'image',
          label: '이미지',
          aliases: ['image', 'img', 'picture'],
          // 파일 선택은 에디터 밖(NoteEditor의 hidden input) — 여기선 '/질의'만 지우고 연다.
          run: (e: Editor, r: Range) => {
            block(e, r).run();
            pickImage();
          },
        },
      ]
    : SLASH_ITEMS;
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    // 표 안의 표는 만들지 않는다 — 셀 안에서 표 항목을 숨긴다.
    if (item.key === 'table' && editor.isActive('table')) return false;
    if (!q) return true;
    return item.label.toLowerCase().includes(q) || item.aliases.some((a) => a.startsWith(q));
  });
}

interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

type SlashMenuProps = SuggestionProps<SlashItem>;

const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(function SlashMenu(
  { items, command },
  ref,
) {
  const [index, setIndex] = useState(0);

  // 필터링으로 목록이 줄면 하이라이트가 목록 밖을 가리키지 않게 되돌린다.
  useEffect(() => setIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (event.key === 'ArrowDown') {
        setIndex((prev) => (prev + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === 'ArrowUp') {
        setIndex((prev) => (prev - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === 'Enter') {
        const item = items[index];
        if (item) command(item);
        return items.length > 0;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md">
        일치하는 블록이 없어요
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="블록 삽입"
      className="flex max-h-64 min-w-40 flex-col overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
    >
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={i === index}
          className={cn(
            'rounded px-2 py-1.5 text-left text-sm',
            i === index ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
          )}
          onMouseEnter={() => setIndex(i)}
          onClick={() => command(item)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
});

// 메뉴를 캐럿 좌표에 고정한다. clientRect는 viewport 기준이라 position: fixed와 궁합이 맞다.
function placeMenu(element: HTMLElement, rect: DOMRect | null) {
  if (!rect) return;
  element.style.position = 'fixed';
  element.style.zIndex = '50';
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.bottom + 4}px`;
}

interface SlashCommandOptions {
  /** 이미지 파일 선택기를 여는 콜백 — 에디터 컴포넌트가 configure로 넘긴다(KAN-38). */
  pickImage: (() => void) | null;
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return { pickImage: null };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        // 코드 블록 안의 '/'는 코드다 — 메뉴를 열지 않는다.
        allow: ({ editor }) => !editor.isActive('codeBlock'),
        items: ({ editor, query }) => filterItems(editor, query, this.options.pickImage),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let component: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null;

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              document.body.appendChild(component.element);
              placeMenu(component.element as HTMLElement, props.clientRect?.() ?? null);
            },
            onUpdate: (props) => {
              component?.updateProps(props);
              if (component) {
                placeMenu(component.element as HTMLElement, props.clientRect?.() ?? null);
              }
            },
            onKeyDown: ({ event }) => {
              if (event.key === 'Escape') {
                component?.destroy();
                component?.element.remove();
                component = null;
                return true;
              }
              return component?.ref?.onKeyDown(event) ?? false;
            },
            onExit: () => {
              component?.element.remove();
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});
