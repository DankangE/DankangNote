'use client';

import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor, JSONContent } from '@tiptap/core';
import { Stack } from '@astryxdesign/core/Stack';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { noteEditorExtensions } from '@/features/notes/editor';

type NoteEditorProps = {
  doc: JSONContent;
  onChange: (doc: JSONContent) => void;
  ariaLabel: string;
};

// 편집용 Tiptap 에디터. content는 마운트 시 1회만 seed되므로, 편집 진입마다 새로
// 마운트되는 위치(NoteCard의 편집 분기)나 key 교체(NoteComposer)로 재seed한다.
export function NoteEditor({ doc, onChange, ariaLabel }: NoteEditorProps) {
  const editor = useEditor({
    extensions: noteEditorExtensions,
    content: doc,
    // Next SSR에서 즉시 렌더하면 서버/클라 마크업이 어긋난다 — 클라 마운트 후 렌더.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        // StyleX 빌드 없이 최소 입력 어피던스·줄바꿈 보존만 인라인으로 준다.
        style: 'white-space: pre-wrap; min-height: 6rem; outline: none;',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });

  if (!editor) return null;

  return (
    <Stack direction="vertical" gap={2}>
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </Stack>
  );
}

// 툴바는 editor가 확정된 뒤에만 렌더된다 — useEditorState를 조건 없이 호출하기 위해
// 별도 컴포넌트로 분리한다(훅 규칙).
function EditorToolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      h1: editor.isActive('heading', { level: 1 }),
      h2: editor.isActive('heading', { level: 2 }),
      h3: editor.isActive('heading', { level: 3 }),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      blockquote: editor.isActive('blockquote'),
      code: editor.isActive('code'),
    }),
  });

  return (
    <Stack direction="horizontal" gap={1}>
      <ToggleButton
        size="sm"
        label="굵게"
        isPressed={active.bold}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
      />
      <ToggleButton
        size="sm"
        label="기울임"
        isPressed={active.italic}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToggleButton
        size="sm"
        label="제목1"
        isPressed={active.h1}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToggleButton
        size="sm"
        label="제목2"
        isPressed={active.h2}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToggleButton
        size="sm"
        label="제목3"
        isPressed={active.h3}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />
      <ToggleButton
        size="sm"
        label="글머리목록"
        isPressed={active.bulletList}
        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToggleButton
        size="sm"
        label="번호목록"
        isPressed={active.orderedList}
        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToggleButton
        size="sm"
        label="인용"
        isPressed={active.blockquote}
        onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToggleButton
        size="sm"
        label="코드"
        isPressed={active.code}
        onPressedChange={() => editor.chain().focus().toggleCode().run()}
      />
    </Stack>
  );
}
