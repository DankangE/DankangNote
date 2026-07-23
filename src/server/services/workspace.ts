import 'server-only';

import { prisma } from '@/server/db';
import type { Prisma } from '@/server/generated/prisma/client';

// Membership에 User 미러를 조인한 멤버 행. 미러 테이블은 webhook으로만 채워지는
// eventual consistent 사본이다 — role은 표시용이며 권한 판단(authz)에 쓰지 않는다(KAN-12).
export type WorkspaceMember = Prisma.MembershipGetPayload<{ include: { user: true } }>;

export function listMembers(orgId: string): Promise<WorkspaceMember[]> {
  return prisma.membership.findMany({
    where: { orgId },
    include: { user: true },
    // createdAt은 동기화 시각이라 동시 upsert로 값이 겹칠 수 있다 — id 타이브레이커로 순서 고정.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}
