// Yjs 문서에서 본문을 담는 XML 조각의 이름 (KAN-39).
//
// 서버 서비스(note-doc.ts)와 클라이언트 확장 설정이 **같은 값**을 써야 한다 — 다르면 양쪽이
// 서로 다른 조각을 편집해 화면에는 아무 일도 일어나지 않고 데이터만 조용히 갈라진다.
// 서비스는 server-only라 클라이언트가 import할 수 없어 상수만 여기로 뺀다.
export const NOTE_DOC_FIELD = 'default';
