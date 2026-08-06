'use client';

import { useMemo } from 'react';
import type { JSONContent } from '@tiptap/core';
import { renderToReactElement } from '@tiptap/static-renderer/pm/react';
import { noteEditorExtensions } from '@/features/notes/editor';
import { docToPlainText } from '@/features/notes/content';

// 저장된 doc을 읽기 전용으로 렌더한다. 정적 렌더러는 확장 스키마로 노드/마크를 해석해
// React 엘리먼트를 만들므로 raw HTML 주입이 없다(XSS 안전). 예외 시 순수 텍스트로 폴백.
export function NoteContent({ doc }: { doc: JSONContent }) {
  const rendered = useMemo(() => {
    try {
      return renderToReactElement({ content: doc, extensions: noteEditorExtensions });
    } catch {
      return null;
    }
  }, [doc]);

  if (rendered === null) {
    return <p className="whitespace-pre-wrap">{docToPlainText(doc)}</p>;
  }
  // prose로 Tiptap 렌더 콘텐츠(h1/ul 등)에 서식 부여 — Tailwind preflight가 리셋한 걸 복원.
  // 체크박스 pointer-events 차단: 정적 렌더의 체크박스는 눌러도 저장되지 않는다(KAN-38) —
  // 토글되는 척만 하는 UI보다 아예 안 눌리는 쪽이 정직하다. 편집은 에디터에서.
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&_input]:pointer-events-none">
      {rendered}
    </div>
  );
}
