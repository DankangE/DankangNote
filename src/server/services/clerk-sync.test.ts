import { beforeEach, describe, expect, it } from 'vitest';
import type { OrganizationWebhookEvent, UserWebhookEvent } from '@clerk/nextjs/webhooks';
import { prisma } from '@/server/db';
import { ORG_A, USER_OWNER, resetDatabase } from '../../../test/db';
import { deleteOrganization, deleteUser, upsertOrganization, upsertUser } from './clerk-sync';

type UserData = Exclude<UserWebhookEvent, { type: 'user.deleted' }>['data'];
type OrganizationData = Exclude<OrganizationWebhookEvent, { type: 'organization.deleted' }>['data'];

// Clerk payload는 필드가 수십 개인데 동기화가 읽는 건 소수다. 테스트가 읽히도록 필요한
// 필드만 만들고 여기 한 곳에서만 단언한다 — 페이로드 스키마가 바뀌면 서비스의 실제
// 접근부(primaryEmail 등)에서 타입 에러로 드러난다.
function userPayload(fields: {
  id: string;
  updatedAt: number;
  firstName?: string | null;
  email?: string | null;
}): UserData {
  return {
    id: fields.id,
    updated_at: fields.updatedAt,
    first_name: fields.firstName ?? null,
    last_name: null,
    image_url: null,
    primary_email_address_id: fields.email ? 'idn_primary' : null,
    email_addresses: fields.email
      ? [{ id: 'idn_primary', email_address: fields.email }]
      : [],
  } as unknown as UserData;
}

function orgPayload(fields: { id: string; updatedAt: number; name: string }): OrganizationData {
  return {
    id: fields.id,
    updated_at: fields.updatedAt,
    name: fields.name,
    slug: null,
    image_url: null,
  } as unknown as OrganizationData;
}

// 이벤트 시각 — 순서 역전을 만들기 위한 두 시점.
const EARLIER = Date.parse('2026-07-01T00:00:00Z');
const LATER = Date.parse('2026-07-02T00:00:00Z');

beforeEach(async () => {
  await resetDatabase();
});

describe('순서 역전 가드 — clerkUpdatedAt (KAN-12)', () => {
  it('나중 이벤트가 먼저 도착하면, 뒤늦게 온 옛 이벤트가 값을 되돌리지 못한다', async () => {
    await upsertUser(userPayload({ id: USER_OWNER, updatedAt: LATER, firstName: '최신' }));
    await upsertUser(userPayload({ id: USER_OWNER, updatedAt: EARLIER, firstName: '옛날' }));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_OWNER } });
    expect(user.firstName).toBe('최신');
  });

  it('정순으로 오면 최신 값이 반영된다', async () => {
    await upsertUser(userPayload({ id: USER_OWNER, updatedAt: EARLIER, firstName: '옛날' }));
    await upsertUser(userPayload({ id: USER_OWNER, updatedAt: LATER, firstName: '최신' }));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_OWNER } });
    expect(user.firstName).toBe('최신');
  });

  it('조직 이름도 같은 가드를 받는다', async () => {
    await upsertOrganization(orgPayload({ id: ORG_A, updatedAt: LATER, name: '새 이름' }));
    await upsertOrganization(orgPayload({ id: ORG_A, updatedAt: EARLIER, name: '옛 이름' }));

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ORG_A } });
    expect(org.name).toBe('새 이름');
  });

  it('같은 ms의 이벤트는 마지막 도착이 이긴다 (lte 가드)', async () => {
    await upsertUser(userPayload({ id: USER_OWNER, updatedAt: LATER, firstName: '먼저' }));
    await upsertUser(userPayload({ id: USER_OWNER, updatedAt: LATER, firstName: '나중' }));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_OWNER } });
    expect(user.firstName).toBe('나중');
  });

  it('웹훅을 거치지 않은 스켈레톤 행(clerkUpdatedAt=null)은 어떤 이벤트로도 채워진다', async () => {
    await prisma.user.create({ data: { id: USER_OWNER } });

    await upsertUser(userPayload({ id: USER_OWNER, updatedAt: EARLIER, firstName: '웹훅이 채움' }));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_OWNER } });
    expect(user.firstName).toBe('웹훅이 채움');
    expect(user.clerkUpdatedAt).not.toBeNull();
  });
});

describe('부활 차단 — tombstone (KAN-12)', () => {
  it('삭제 후 지연 도착한 upsert가 사용자를 되살리지 못한다', async () => {
    await upsertUser(userPayload({ id: USER_OWNER, updatedAt: EARLIER, firstName: '있었음' }));
    await deleteUser(USER_OWNER);

    // 재시도로 뒤늦게 도착한 user.updated — 삭제보다 더 새로운 시각이어도 부활 금지.
    await upsertUser(userPayload({ id: USER_OWNER, updatedAt: LATER, firstName: '유령' }));

    expect(await prisma.user.count({ where: { id: USER_OWNER } })).toBe(0);
  });

  it('삭제 후 지연 도착한 upsert가 조직을 되살리지 못한다', async () => {
    await upsertOrganization(orgPayload({ id: ORG_A, updatedAt: EARLIER, name: '있었음' }));
    await deleteOrganization(ORG_A);

    await upsertOrganization(orgPayload({ id: ORG_A, updatedAt: LATER, name: '유령' }));

    expect(await prisma.organization.count({ where: { id: ORG_A } })).toBe(0);
  });

  it('삭제 기록은 영구적이다 — Clerk id는 재사용되지 않는다', async () => {
    await deleteUser(USER_OWNER);
    expect(await prisma.clerkTombstone.count({ where: { id: USER_OWNER } })).toBe(1);

    // 같은 삭제 이벤트가 재전송돼도 중복 없이 멱등하다.
    await deleteUser(USER_OWNER);
    expect(await prisma.clerkTombstone.count({ where: { id: USER_OWNER } })).toBe(1);
  });

  it('조직 삭제는 그 조직의 노트·채널·메시지·보드까지 파기한다', async () => {
    await upsertOrganization(orgPayload({ id: ORG_A, updatedAt: EARLIER, name: '워크스페이스' }));
    await upsertUser(userPayload({ id: USER_OWNER, updatedAt: EARLIER }));
    await prisma.note.create({ data: { orgId: ORG_A, authorId: USER_OWNER, title: '노트' } });
    const channel = await prisma.channel.create({
      data: { orgId: ORG_A, name: '일반', isDefault: true },
    });
    await prisma.chatMessage.create({
      data: { orgId: ORG_A, channelId: channel.id, authorId: USER_OWNER, body: '메시지' },
    });
    await prisma.boardColumn.create({ data: { orgId: ORG_A, name: '컬럼', position: 0 } });

    await deleteOrganization(ORG_A);

    expect(await prisma.note.count()).toBe(0);
    expect(await prisma.channel.count()).toBe(0);
    expect(await prisma.chatMessage.count()).toBe(0);
    expect(await prisma.boardColumn.count()).toBe(0);
    // 사용자 미러는 조직에 매달려 있지 않다 — 다른 워크스페이스에도 속할 수 있다.
    expect(await prisma.user.count({ where: { id: USER_OWNER } })).toBe(1);
  });
});
