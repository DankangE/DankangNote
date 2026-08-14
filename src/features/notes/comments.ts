import type { JSONContent } from '@tiptap/core';

// 인라인 코멘트의 공용 규칙 (KAN-40). 첨부(attachments.ts)와 같은 이유로 별도 모듈이다 —
// content.ts가 validation.ts를 import하므로 validation이 쓸 상수를 content에 두면 순환이 된다.

/**
 * 코멘트 본문 길이 상한 — 코멘트는 문서가 아니라 한마디다. 검증(zod)과 입력 UI가 같은 값을
 * 봐야 '쓸 수는 있는데 저장이 안 되는' 자리가 안 생긴다.
 */
export const MAX_COMMENT_BODY = 2_000;

/** 본문에서 코멘트 범위를 표시하는 마크 이름. 에디터·zod·정적 뷰가 이 이름을 공유한다. */
export const COMMENT_MARK = 'comment';

/** 마크가 DOM으로 나갈 때 쓰는 속성 이름 — parseHTML과 renderHTML이 같은 것을 본다. */
export const COMMENT_ID_ATTR = 'data-comment-thread';

/**
 * threadId의 형태. cuid 하나만 허용한다 — 이 값은 본문 JSON에 저장돼 화면에 그대로 실려
 * 나가고, DOM 속성으로도 나간다. 형태를 안 걸면 붙여넣은 HTML의 임의 문자열이 그 자리에
 * 앉는다(KAN-38의 이미지 src와 같은 부류이고, 같은 정규식을 **두 곳이 함께 본다**: 에디터의
 * parseHTML과 저장 쪽 zod. 정규식 하나를 양쪽이 import하면 갈라질 자리가 없다 — 규약 25).
 */
export const COMMENT_THREAD_ID_RE = /^[a-z0-9]{1,64}$/;

/**
 * 본문이 참조하는 스레드 id 목록 — 저장 시 '살아 있는 스레드만 남기기'의 근거이고,
 * 화면에서는 '이 스레드가 아직 본문에 붙어 있는가'(고아 판정)의 근거다.
 *
 * 반복 순회라 깊은 doc에도 스택이 안전하다(collectNoteAttachmentIds와 같은 이유).
 */
export function collectCommentThreadIds(doc: JSONContent): string[] {
  const ids = new Set<string>();
  const stack: JSONContent[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const mark of node.marks ?? []) {
      if (mark.type !== COMMENT_MARK) continue;
      const threadId = mark.attrs?.threadId;
      if (typeof threadId === 'string' && COMMENT_THREAD_ID_RE.test(threadId)) {
        ids.add(threadId);
      }
    }
    for (const child of node.content ?? []) stack.push(child);
  }
  return [...ids];
}
