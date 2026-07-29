import 'server-only';

import type { User } from '@/server/generated/prisma/client';

/**
 * Clerk 미러 User의 표시 이름. 이름 → 이메일 → id 순으로 떨어진다.
 * 미러는 webhook으로만 채워지므로 동기화 전에는 빈 행일 수 있고, 그때 id로 떨어지는 게
 * '알 수 없는 사용자'보다 낫다(누가 말했는지는 최소한 구분된다).
 */
export function displayName(user: Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.id;
}
