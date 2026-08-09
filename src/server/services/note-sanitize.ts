import 'server-only';

import { getSchema } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { noteEditorExtensions } from '@/features/notes/editor';
import { NOTE_ATTACHMENT_ROUTE, NOTE_ATTACHMENT_SRC_RE } from '@/features/notes/attachments';

// 저장 직전에 문서에서 **스키마가 받을 수 없는 노드**를 떨군다 (KAN-72에서 만들고 KAN-73에서
// 두 저장 경로가 함께 쓰도록 옮겼다).
//
// 왜 거부가 아니라 떨구기인가: 검증은 문서 **전체**를 거부하므로 블록 하나가 제목까지 포함한
// 저장을 통째로 막고, 사용자에게는 어느 블록이 문제인지 보이지 않는다(규약 25). 공동 편집
// 경로에는 오류를 돌려줄 상대조차 없어 거부가 곧 content 동결이다.
//
// 두 경로가 한 함수를 부르는 것이 핵심이다(규약 10) — 두 벌로 두면 한쪽만 새 노드 타입을
// 배워서, 같은 문서가 어떤 경로로 저장되느냐에 따라 다르게 남는다.

/** 이 에디터 스키마가 아는 노드 타입 전부 — 화이트리스트의 근거를 스키마에서 가져온다. */
const ALLOWED_NODE_TYPES = new Set(Object.keys(getSchema(noteEditorExtensions).nodes));

/**
 * 남길 수 없는 노드를 떨군 문서를 돌려준다. `usable`은 지금 이 노트에 묶을 수 있는 첨부 id다.
 *
 * 처음에는 최상위 자식 중 `type === 'image'`인 것만 봤다. 그건 **한 인스턴스만 고치고 부류를
 * 닫았다고 선언한 것**이었고(규약 25), 리뷰가 세 갈래를 뚫었다: 허용된 이미지의 자식으로 심은
 * 이미지(재귀를 안 했다), image가 아닌 노드에 붙인 `src`, 스키마에 없는 노드 타입.
 * 그래서 근거를 스키마에서 가져와 전체를 훑는다 — 모르는 타입과 우리 라우트 밖 `src`는
 * 어디에 있든 떨군다.
 */
export function sanitizeNoteDoc(node: JSONContent, usable: ReadonlySet<string>): JSONContent {
  const children = node.content?.flatMap((child) =>
    keep(child, usable) ? [sanitizeNoteDoc(child, usable)] : [],
  );
  return children ? { ...node, content: children } : node;
}

function keep(node: JSONContent, usable: ReadonlySet<string>): boolean {
  if (typeof node.type !== 'string' || !ALLOWED_NODE_TYPES.has(node.type)) return false;
  const src = node.attrs?.src;
  if (src === undefined || src === null) return true;
  if (typeof src !== 'string') return false;
  if (!src.startsWith(NOTE_ATTACHMENT_ROUTE) || !NOTE_ATTACHMENT_SRC_RE.test(src)) return false;
  return usable.has(src.slice(NOTE_ATTACHMENT_ROUTE.length));
}
