import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  ORG_A,
  ORG_B,
  USER_ADMIN,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedTenants,
} from '../../../test/db';
import { listMembers } from './workspace';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
  await prisma.membership.createMany({
    data: [
      { id: 'orgmem_a1', orgId: ORG_A, userId: USER_OWNER, role: 'org:member' },
      { id: 'orgmem_a2', orgId: ORG_A, userId: USER_ADMIN, role: 'org:admin' },
      { id: 'orgmem_b1', orgId: ORG_B, userId: USER_OTHER, role: 'org:member' },
    ],
  });
});

describe('멀티테넌시 격리', () => {
  it('listMembers는 자기 org의 멤버만 반환한다', async () => {
    const inA = await listMembers(ORG_A);
    const inB = await listMembers(ORG_B);

    expect(inA.map((m) => m.userId).sort()).toEqual([USER_ADMIN, USER_OWNER].sort());
    expect(inB.map((m) => m.userId)).toEqual([USER_OTHER]);
  });

  it('멤버 행에 User 미러가 조인돼 온다', async () => {
    await prisma.user.update({ where: { id: USER_OWNER }, data: { email: 'owner@example.com' } });

    const members = await listMembers(ORG_A);
    const owner = members.find((m) => m.userId === USER_OWNER);

    expect(owner?.user.email).toBe('owner@example.com');
  });
});

describe('테넌트 수명', () => {
  it('조직을 지우면 그 조직의 멤버십이 함께 파기된다', async () => {
    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.membership.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.membership.count({ where: { orgId: ORG_B } })).toBe(1);
  });

  it('사용자를 지우면 그 사용자의 멤버십도 함께 파기된다', async () => {
    await prisma.user.delete({ where: { id: USER_OWNER } });

    expect(await prisma.membership.count({ where: { userId: USER_OWNER } })).toBe(0);
    expect(await prisma.membership.count({ where: { orgId: ORG_A } })).toBe(1);
  });
});
