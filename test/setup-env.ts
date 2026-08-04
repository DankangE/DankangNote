import { testDatabaseUrl } from './database-url';

// 각 테스트 워커에서 @/server/db가 import되기 전에 DATABASE_URL을 테스트 DB로 바꾼다.
// db.ts는 모듈 로드 시점에 이 값을 읽어 Prisma 클라이언트를 만든다.
process.env.DATABASE_URL = testDatabaseUrl();

// 첨부 스토리지(KAN-35). presign은 오프라인 서명이라 **네트워크 없이** 동작한다 — 실제
// MinIO가 없어도(CI 포함) 이 더미 값으로 storage 모듈이 켜지고, 서비스 테스트는 행·바인딩·
// 접근 판정(전부 DB)을 검증한다. 실제 바이트 업로드는 dev 환경의 런타임 검증 몫이다.
// ??= 라서 진짜 값을 주입한 환경은 그대로 존중한다.
process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_REGION ??= 'us-east-1';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test-secret';
process.env.S3_BUCKET ??= 'test-attachments';
