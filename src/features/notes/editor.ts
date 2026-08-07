import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import type { Extensions } from '@tiptap/core';
import { NOTE_ATTACHMENT_SRC_RE } from '@/features/notes/attachments';

// 노트 본문에서 허용하는 제목 레벨. api/validation.ts의 zod 화이트리스트(1|2|3)와 값이
// 일치해야 한다 — validation은 isomorphic이라 여기(StarterKit 런타임 import)에 의존할 수
// 없어 수동으로 동기화한다.
export const HEADING_LEVELS = [1, 2, 3] as const;

// 편집(에디터)과 뷰(정적 렌더)가 같은 스키마를 쓰도록 확장 목록을 한 곳에서 정의한다.
// link 비활성화: 저장 JSON의 href는 에디터 입력 규칙의 프로토콜 새니타이즈를 거치지
// 않아(클라이언트가 액션에 임의 doc을 POST할 수 있으므로) javascript: 등 저장형 XSS
// 벡터가 된다. MVP 스코프(제목·굵게·기울임·목록·인용)에도 링크는 없다.
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

export const noteEditorExtensions: Extensions = [
  StarterKit.configure({
    link: false,
    heading: { levels: [...HEADING_LEVELS] },
  }),
  // 체크리스트 (KAN-38). nested: Tab으로 하위 체크 항목을 만든다 — 깊이 폭주는
  // validation.ts의 MAX_DEPTH 선검사가 막는다.
  TaskList,
  TaskItem.configure({ nested: true }),
  // 표 (KAN-38). 리사이즈는 켜지 않는다 — colwidth가 픽셀값으로 저장돼 화면 폭이 다른
  // 사람에게 그대로 강요되고, MVP에 드래그 리사이즈 UX까지 얹을 이유가 없다.
  TableKit,
  NoteImage,
];
