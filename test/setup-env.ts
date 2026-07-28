import { testDatabaseUrl } from './database-url';

// 각 테스트 워커에서 @/server/db가 import되기 전에 DATABASE_URL을 테스트 DB로 바꾼다.
// db.ts는 모듈 로드 시점에 이 값을 읽어 Prisma 클라이언트를 만든다.
process.env.DATABASE_URL = testDatabaseUrl();
