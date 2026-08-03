import 'server-only';

import { prisma } from '@/server/db';
import type { Prisma } from '@/server/generated/prisma/client';

// webhook이 아직 Clerk 미러를 안 채운 시점에도 FK가 성립하게 하는 create-if-absent 문장.
// 생성 트랜잭션의 첫 문장으로 끼워 쓴다(notes.createNote가 세운 패턴 — KAN-11).
//
// upsert가 아닌 createMany+skipDuplicates인 이유: Prisma 7 쿼리 컴파일러는 upsert를
// SELECT→INSERT로 에뮬레이션해 동시 생성 시 P2002로 죽지만, 이 형태는 네이티브
// INSERT ... ON CONFLICT DO NOTHING으로 컴파일된다.
//
// 스켈레톤은 삭제된 리소스를 되살릴 수 있으므로 반드시 assertNotTombstoned pre/post와
// 함께 쓴다(clerk-tombstone.ts).

/** org 미러 스켈레톤. name은 세션에서 알 수 없어 orgId로 두고 webhook이 교정한다. */
export const orgSkeleton = (orgId: string) =>
  prisma.organization.createMany({ data: [{ id: orgId, name: orgId }], skipDuplicates: true });

/**
 * 사용자 미러 스켈레톤. 표시 정보는 user.* webhook이 채운다.
 *
 * client를 받는 것은 대화형 트랜잭션(`$transaction(async (tx) => ...)`) 때문이다 — 거기서
 * 전역 prisma로 문장을 내면 그 문장만 트랜잭션 **밖**에서 실행돼, 롤백돼야 할 스켈레톤이
 * 남는다. 배열 트랜잭션에서는 기존처럼 인자 없이 쓰면 된다.
 */
export const userSkeleton = (userId: string, client: Prisma.TransactionClient = prisma) =>
  client.user.createMany({ data: [{ id: userId }], skipDuplicates: true });
