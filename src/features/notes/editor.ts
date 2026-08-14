import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { Mark, mergeAttributes } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import { NOTE_ATTACHMENT_SRC_RE } from '@/features/notes/attachments';
import {
  COMMENT_ID_ATTR,
  COMMENT_MARK,
  COMMENT_THREAD_ID_RE,
} from '@/features/notes/comments';

// 노트 본문에서 허용하는 제목 레벨. api/validation.ts의 zod 화이트리스트(1|2|3)와 값이
// 일치해야 한다 — validation은 isomorphic이라 여기(StarterKit 런타임 import)에 의존할 수
// 없어 수동으로 동기화한다.
export const HEADING_LEVELS = [1, 2, 3] as const;

// 이미지 (KAN-38). src는 우리 첨부 라우트만 저장된다 — zod 정규식(validation.ts)이 외부
// URL·data:·javascript: 를 형태 수준에서 거부하고, 업로드는 attachments.ts의 presign
// 경로만 있다. base64 인라인은 허용하지 않는다(50KB 본문 상한도 뚫린다).
//
// 기본 Image를 그대로 쓰면 **에디터가 저장 불가능한 문서를 만든다**: parseHTML이
// `img[src]:not([src^="data:"])`라 웹에서 복사한 <img>를 그대로 노드로 받고, 입력 규칙은
// `![alt](url)` 타이핑까지 노드로 바꾼다. 그런 노드가 하나만 있어도 zod가 doc **전체**를
// 거부해 제목까지 저장이 막히는데, 사용자에게는 어느 블록이 문제인지 보이지 않는다.
// 그래서 들어오는 자리에서 끊는다 — 화이트리스트를 두 곳(저장·에디터)이 함께 본다.
const NoteImage = Image.extend({
  // getAttrs가 false면 ProseMirror가 이 규칙을 적용하지 않아 노드 자체가 안 생긴다.
  // 붙여넣은 외부 이미지는 KAN-38 이전과 같이 조용히 버려진다(그때는 확장이 없어서였다).
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (element: HTMLElement) => {
          const src = element.getAttribute('src');
          return src !== null && NOTE_ATTACHMENT_SRC_RE.test(src) ? null : false;
        },
      },
    ];
  },
  // `![alt](url)` 입력 규칙은 임의 URL로 image 노드를 만드는 유일한 남은 경로다. 이미지를
  // 넣는 길은 툴바·슬래시 커맨드의 presign 업로드 하나로 둔다.
  addInputRules() {
    return [];
  },
});

/**
 * 인라인 코멘트 앵커 (KAN-40) — 텍스트 범위에 스레드 id를 붙이는 마크.
 *
 * 앵커를 마크로 두는 이유는 공동 편집이다(KAN-39). 위치를 숫자로 DB에 적어 두면 남이 앞
 * 문단에 한 글자만 쳐도 전부 어긋나고, 그걸 맞추는 건 CRDT가 이미 푼 문제를 다시 푸는
 * 일이다. 마크는 텍스트와 함께 움직이므로 Yjs가 앵커를 공짜로 유지해 준다.
 *
 * `inclusive: false` — 강조 구간의 **끝에 이어 치는 글자**가 코멘트에 딸려 들어가지 않게
 * 한다. 기본값(true)이면 문장 끝에 코멘트를 달고 이어 쓸 때 새 글자가 계속 범위에 먹힌다.
 *
 * parseHTML은 형태를 검사한다 — 저장 쪽 zod와 **같은 정규식**을 본다(규약 25). 붙여넣은
 * HTML의 임의 문자열이 threadId 자리에 앉으면, 저장은 정규화가 막아 주더라도 그때까지의
 * 화면에는 존재하지 않는 스레드를 가리키는 강조가 떠 있게 된다.
 */
const CommentMark = Mark.create({
  name: COMMENT_MARK,
  // 코멘트 범위는 겹칠 수 있다 — 한 문장에 두 사람이 각자 스레드를 달 수 있어야 한다.
  excludes: '',
  inclusive: false,

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute(COMMENT_ID_ATTR);
          return value !== null && COMMENT_THREAD_ID_RE.test(value) ? value : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const threadId = attributes.threadId;
          return typeof threadId === 'string' ? { [COMMENT_ID_ATTR]: threadId } : {};
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `span[${COMMENT_ID_ATTR}]`,
        // getAttrs가 false면 규칙이 적용되지 않아 마크 자체가 안 생긴다(NoteImage와 같은 장치).
        getAttrs: (element: HTMLElement) => {
          const value = element.getAttribute(COMMENT_ID_ATTR);
          return value !== null && COMMENT_THREAD_ID_RE.test(value) ? null : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'note-comment-anchor' }), 0];
  },
});

// 편집(에디터)과 뷰(정적 렌더)가 같은 스키마를 쓰도록 확장 목록을 한 곳에서 정의한다.
// link 비활성화: 저장 JSON의 href는 에디터 입력 규칙의 프로토콜 새니타이즈를 거치지
// 않아(클라이언트가 액션에 임의 doc을 POST할 수 있으므로) javascript: 등 저장형 XSS
// 벡터가 된다. MVP 스코프(제목·굵게·기울임·목록·인용)에도 링크는 없다.
//
// 숫자·문자열 attr(`start`·`colspan`·`colwidth`·`language`)은 여기서 손대지 않는다 —
// 확장들의 parseHTML이 붙여넣은 HTML의 값을 검증 없이 받지만, 그건 저장 쪽 zod가
// **거부가 아니라 정규화**로 흡수한다(KAN-72, validation.ts). src와 달리 '가까운 올바른
// 값'이 있어 접을 수 있고, 그렇게 두면 액션에 raw JSON을 직접 POST하는 경로까지 덮인다.
/**
 * 확장 목록. `undoRedo`만 갈라지는 이유는 공동 편집(KAN-39) 때문이다 — Yjs는 자기 되돌리기
 * 스택(UndoManager)을 들고 오는데, ProseMirror의 히스토리를 함께 켜 두면 남이 친 글자까지
 * 내 Ctrl+Z가 되돌린다. 그래서 협업 모드에서만 끈다.
 */
export function buildNoteEditorExtensions(options?: { undoRedo?: boolean }): Extensions {
  return [
    StarterKit.configure({
      link: false,
      heading: { levels: [...HEADING_LEVELS] },
      ...(options?.undoRedo === false ? { undoRedo: false as const } : {}),
    }),
    // 체크리스트 (KAN-38). nested: Tab으로 하위 체크 항목을 만든다 — 깊이 폭주는
    // validation.ts의 MAX_DEPTH 선검사가 막는다.
    TaskList,
    TaskItem.configure({ nested: true }),
    // 표 (KAN-38). 리사이즈는 켜지 않는다 — colwidth가 픽셀값으로 저장돼 화면 폭이 다른
    // 사람에게 그대로 강요되고, MVP에 드래그 리사이즈 UX까지 얹을 이유가 없다.
    TableKit,
    NoteImage,
    // 인라인 코멘트 앵커 (KAN-40). 정적 뷰도 같은 마크를 알아야 저장된 강조가 읽기 화면에서
    // 사라지지 않는다 — 그래서 편집 전용이 아니라 공용 목록에 있다.
    CommentMark,
  ];
}

// 편집(에디터)과 뷰(정적 렌더)가 공유하는 기본 목록 — 스키마가 갈라지면 저장된 문서가
// 뷰에서 다르게 읽힌다.
export const noteEditorExtensions: Extensions = buildNoteEditorExtensions();
