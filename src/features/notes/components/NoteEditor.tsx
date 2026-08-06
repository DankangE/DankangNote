'use client';

import { useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor, JSONContent } from '@tiptap/core';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { noteEditorExtensions } from '@/features/notes/editor';
import { uploadNoteImage } from '@/features/notes/attachments';
import { SlashCommand } from './SlashCommand';
import { FormError } from './FormError';

type NoteEditorProps = {
  doc: JSONContent;
  onChange: (doc: JSONContent) => void;
  ariaLabel: string;
};

// 편집용 Tiptap 에디터. content는 마운트 시 1회만 seed되므로, 편집 진입마다 새로
// 마운트되는 위치(NoteCard의 편집 분기)나 key 교체(NoteComposer)로 재seed한다.
export function NoteEditor({ doc, onChange, ariaLabel }: NoteEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // 편집 전용 확장 — 슬래시 커맨드는 입력 플러그인이라 정적 뷰(스키마만 쓰는 static
  // renderer) 목록(editor.ts)에는 넣지 않는다. 이미지 선택기는 이 컴포넌트의 hidden
  // input이므로 인스턴스별로 configure한다(ref 경유라 콜백은 안정적).
  const extensions = useMemo(
    () => [
      ...noteEditorExtensions,
      SlashCommand.configure({ pickImage: () => fileInputRef.current?.click() }),
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    content: doc,
    // Next SSR에서 즉시 렌더하면 서버/클라 마크업이 어긋난다 — 클라 마운트 후 렌더.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        // Tiptap 소유 contenteditable에 Tailwind 클래스로 서식·어피던스를 준다.
        // prose: 편집 중 WYSIWYG 서식, whitespace-pre-wrap: ProseMirror 동작상 필수.
        class:
          'prose prose-sm dark:prose-invert max-w-none min-h-24 whitespace-pre-wrap rounded-md border px-3 py-2 focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });

  if (!editor) return null;

  async function handleImageChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 같은 파일을 연속으로 고를 수 있게 비운다(change 이벤트는 값이 바뀔 때만 온다).
    event.target.value = '';
    if (!file || !editor || uploading) return;
    setUploadError(null);
    setUploading(true);
    try {
      const result = await uploadNoteImage(file);
      if (result.ok) {
        editor.chain().focus().setImage({ src: result.src }).run();
      } else {
        setUploadError(result.error);
      }
    } catch {
      setUploadError('이미지 업로드에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <EditorToolbar
        editor={editor}
        uploading={uploading}
        onPickImage={() => fileInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={handleImageChosen}
      />
      <FormError message={uploadError} />
      <EditorContent editor={editor} />
    </div>
  );
}

// 툴바는 editor가 확정된 뒤에만 렌더된다 — useEditorState를 조건 없이 호출하기 위해
// 별도 컴포넌트로 분리한다(훅 규칙).
function EditorToolbar({
  editor,
  uploading,
  onPickImage,
}: {
  editor: Editor;
  uploading: boolean;
  onPickImage: () => void;
}) {
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
      taskList: editor.isActive('taskList'),
      table: editor.isActive('table'),
    }),
  });

  return (
    <div className="flex flex-wrap gap-1">
      <Toggle size="sm" aria-label="굵게" pressed={active.bold} onPressedChange={() => editor.chain().focus().toggleBold().run()}>
        굵게
      </Toggle>
      <Toggle size="sm" aria-label="기울임" pressed={active.italic} onPressedChange={() => editor.chain().focus().toggleItalic().run()}>
        기울임
      </Toggle>
      <Toggle size="sm" aria-label="제목1" pressed={active.h1} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        제목1
      </Toggle>
      <Toggle size="sm" aria-label="제목2" pressed={active.h2} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        제목2
      </Toggle>
      <Toggle size="sm" aria-label="제목3" pressed={active.h3} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        제목3
      </Toggle>
      <Toggle size="sm" aria-label="글머리목록" pressed={active.bulletList} onPressedChange={() => editor.chain().focus().toggleBulletList().run()}>
        글머리목록
      </Toggle>
      <Toggle size="sm" aria-label="번호목록" pressed={active.orderedList} onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}>
        번호목록
      </Toggle>
      <Toggle size="sm" aria-label="인용" pressed={active.blockquote} onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}>
        인용
      </Toggle>
      <Toggle size="sm" aria-label="코드" pressed={active.code} onPressedChange={() => editor.chain().focus().toggleCode().run()}>
        코드
      </Toggle>
      <Toggle size="sm" aria-label="체크리스트" pressed={active.taskList} onPressedChange={() => editor.chain().focus().toggleTaskList().run()}>
        체크리스트
      </Toggle>
      {/* 표는 토글이 아니라 삽입 액션 — 표 안에서는 중첩 삽입 대신 행/열 컨트롤을 보인다. */}
      {active.table ? (
        <span className="flex items-center gap-1" role="group" aria-label="표 편집">
          <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().addRowAfter().run()}>
            +행
          </Button>
          <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().deleteRow().run()}>
            −행
          </Button>
          <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            +열
          </Button>
          <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().deleteColumn().run()}>
            −열
          </Button>
          <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().deleteTable().run()}>
            표 삭제
          </Button>
        </span>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label="표 삽입"
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          표
        </Button>
      )}
      <Button variant="ghost" size="sm" aria-label="이미지 넣기" disabled={uploading} onClick={onPickImage}>
        {uploading ? '업로드 중…' : '이미지'}
      </Button>
    </div>
  );
}
