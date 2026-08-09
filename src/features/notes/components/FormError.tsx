// 폼 에러 메시지. destructive 토큰이라 라이트/다크 자동 전환된다.
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

/**
 * 성공했지만 요청한 그대로는 아닐 때의 안내 (KAN-73). 실패가 아니므로 destructive가 아니라
 * warning 토큰을 쓴다 — 저장은 됐고, 다만 사용자가 알아야 할 차이가 있다는 뜻이다.
 *
 * role="status"라 스크린 리더가 포커스를 뺏지 않고 읽는다(저장 직후 뜨는 값이라 alert는
 * 과하다).
 */
export function FormNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="text-sm text-warning">
      {message}
    </p>
  );
}
