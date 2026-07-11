import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/server/generated/prisma/client';

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다 (.env 확인)');
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

declare global {
  // dev 핫 리로드 때마다 새 커넥션 풀이 생기지 않도록 globalThis에 캐시한다.
  var prismaSingleton: PrismaClient | undefined;
}

export const prisma = globalThis.prismaSingleton ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaSingleton = prisma;
}
