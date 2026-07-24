import StarterKit from '@tiptap/starter-kit';
import type { Extensions } from '@tiptap/core';

// 노트 본문에서 허용하는 제목 레벨. api/validation.ts의 zod 화이트리스트(1|2|3)와 값이
// 일치해야 한다 — validation은 isomorphic이라 여기(StarterKit 런타임 import)에 의존할 수
// 없어 수동으로 동기화한다.
export const HEADING_LEVELS = [1, 2, 3] as const;

// 편집(에디터)과 뷰(정적 렌더)가 같은 스키마를 쓰도록 확장 목록을 한 곳에서 정의한다.
// link 비활성화: 저장 JSON의 href는 에디터 입력 규칙의 프로토콜 새니타이즈를 거치지
// 않아(클라이언트가 액션에 임의 doc을 POST할 수 있으므로) javascript: 등 저장형 XSS
// 벡터가 된다. MVP 스코프(제목·굵게·기울임·목록·인용)에도 링크는 없다.
export const noteEditorExtensions: Extensions = [
  StarterKit.configure({
    link: false,
    heading: { levels: [...HEADING_LEVELS] },
  }),
];
