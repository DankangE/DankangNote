// 폼 에러 메시지. destructive 토큰이라 라이트/다크 자동 전환된다.
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}
