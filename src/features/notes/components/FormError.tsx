import { Text } from '@astryxdesign/core/Text';

// 폼 에러 메시지. 색은 테마 토큰(--color-text-red)이라 라이트/다크 자동 전환된다.
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={{ color: 'var(--color-text-red)' }}>{message}</Text>;
}
