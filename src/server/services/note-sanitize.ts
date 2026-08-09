import 'server-only';

import { getSchema } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { noteEditorExtensions } from '@/features/notes/editor';
import { NOTE_ATTACHMENT_ROUTE, NOTE_ATTACHMENT_SRC_RE } from '@/features/notes/attachments';
import { COMMENT_MARK } from '@/features/notes/comments';

// 저장 직전에 문서에서 **스키마가 받을 수 없는 것**을 떨군다 (KAN-72에서 만들고 KAN-73에서
// 두 저장 경로가 함께 쓰도록 옮겼다. KAN-40에서 마크까지 본다).
//
// 왜 거부가 아니라 떨구기인가: 검증은 문서 **전체**를 거부하므로 블록 하나가 제목까지 포함한
// 저장을 통째로 막고, 사용자에게는 어느 블록이 문제인지 보이지 않는다(규약 25·29). 공동 편집
// 경로에는 오류를 돌려줄 상대조차 없어 거부가 곧 content 동결이다.
//
// 두 경로가 한 함수를 부르는 것이 핵심이다(규약 10) — 두 벌로 두면 한쪽만 새 노드 타입을
// 배워서, 같은 문서가 어떤 경로로 저장되느냐에 따라 다르게 남는다.

/** 이 에디터 스키마가 아는 노드 타입 전부 — 화이트리스트의 근거를 스키마에서 가져온다. */
const ALLOWED_NODE_TYPES = new Set(Object.keys(getSchema(noteEditorExtensions).nodes));

/**
 * 저장 시점에 '살아 있다'고 판정된 것들. 형태 검사는 zod가 이미 했고, 여기 담기는 것은
 * **DB를 봐야만 알 수 있는 것**이다 — 그 첨부가 이 사람에게 묶을 수 있는 것인지, 그 스레드가
 * 정말 이 노트의 것인지.
 */
export type LiveRefs = {
  attachments: ReadonlySet<string>;
  /** 이 노트에 실재하는 코멘트 스레드 id. 여기 없는 앵커는 가리킬 대상이 없다. */
  threads: ReadonlySet<string>;
};

/**
 * 남길 수 없는 노드·마크를 떨군 문서를 돌려준다.
 *
 * 처음에는 최상위 자식 중 `type === 'image'`인 것만 봤다. 그건 **한 인스턴스만 고치고 부류를
 * 닫았다고 선언한 것**이었고(규약 25), 리뷰가 세 갈래를 뚫었다: 허용된 이미지의 자식으로 심은
 * 이미지(재귀를 안 했다), image가 아닌 노드에 붙인 `src`, 스키마에 없는 노드 타입.
 * 그래서 근거를 스키마에서 가져와 전체를 훑는다 — 모르는 타입과 우리 라우트 밖 `src`는
 * 어디에 있든 떨군다.
 */
export function sanitizeNoteDoc(node: JSONContent, live: LiveRefs): JSONContent {
  const marks = node.marks?.filter((mark) => keepMark(mark, live));
  const children = node.content?.flatMap((child) =>
    keep(child, live) ? [sanitizeNoteDoc(child, live)] : [],
  );
  // 원본 참조를 지키는 대신 바뀐 곳만 새로 만든다 — 문서 대부분은 손댈 것이 없다.
  if (marks === undefined && children === undefined) return node;
  return {
    ...node,
    ...(marks === undefined ? {} : { marks }),
    ...(children === undefined ? {} : { content: children }),
  };
}

function keep(node: JSONContent, live: LiveRefs): boolean {
  if (typeof node.type !== 'string' || !ALLOWED_NODE_TYPES.has(node.type)) return false;
  const src = node.attrs?.src;
  if (src === undefined || src === null) return true;
  if (typeof src !== 'string') return false;
  if (!src.startsWith(NOTE_ATTACHMENT_ROUTE) || !NOTE_ATTACHMENT_SRC_RE.test(src)) return false;
  return live.attachments.has(src.slice(NOTE_ATTACHMENT_ROUTE.length));
}

/**
 * 코멘트 앵커는 **노드가 아니라 마크만** 떨군다 (KAN-40). 스레드가 사라졌다고 그 문장까지
 * 지우면 사용자가 쓴 본문이 없어진다 — 이미지와 정반대다(이미지는 노드 자체가 그 첨부라
 * 가리킬 대상이 없으면 남길 것이 없다).
 *
 * 스레드가 이 노트에 없는 경우는 셋이다: 스레드가 지워졌거나, 다른 노트/조직의 id를 실어
 * 왔거나(붙여넣기·직접 POST), 아직 안 만들어졌거나. 셋 다 결과는 같아야 한다 — 가리킬 곳
 * 없는 강조를 남기면 클릭해도 아무 일이 없는 자리가 본문에 굳는다.
 */
type NoteMark = NonNullable<JSONContent['marks']>[number];

function keepMark(mark: NoteMark, live: LiveRefs): boolean {
  if (mark.type !== COMMENT_MARK) return true;
  const threadId = mark.attrs?.threadId;
  return typeof threadId === 'string' && live.threads.has(threadId);
}
