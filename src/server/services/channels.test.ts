import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  ORG_A,
  ORG_B,
  USER_ADMIN,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedMemberships,
  seedTenants,
} from '../../../test/db';
import {
  inviteToChannel,
  joinChannel,
  leaveChannel,
  listChannelMembers,
  listInvitableMembers,
} from './channel-members';
import { deleteMembership } from './clerk-sync';
import {
  canAccessChannel,
  createChannel,
  deleteChannel,
  ensureDefaultChannel,
  getChannel,
  listChannels,
  updateChannel,
} from './channels';

const owner = { userId: USER_OWNER, isAdmin: false };
const other = { userId: USER_OTHER, isAdmin: false };
const admin = { userId: USER_ADMIN, isAdmin: true };

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
});

/**
 * 서비스 가드를 우회해 '일반'을 비공개 채널로 선점한 상태를 만든다 (KAN-53).
 * createChannel은 이제 이 이름을 거부하므로(예약), 가드가 없던 시절에 만들어졌거나
 * 가드를 넘어선 경로를 흉내 내려면 DB에 직접 심어야 한다.
 */
async function squatDefaultName(orgId: string, userId: string): Promise<string> {
  const channel = await prisma.channel.create({
    data: { orgId, name: '일반', isPrivate: true, createdById: userId, members: { create: { userId } } },
    select: { id: true },
  });
  return channel.id;
}

/** 테스트 편의 — 성공을 전제로 채널 id를 뽑는다. */
async function makeChannel(
  orgId: string,
  userId: string,
  name: string,
  isPrivate = false,
): Promise<string> {
  const outcome = await createChannel(orgId, userId, { name, topic: null, isPrivate });
  if (outcome.status !== 'ok') {
    throw new Error(`채널 생성 실패: ${outcome.status}`);
  }
  return outcome.channel.id;
}

describe('기본 채널 부트스트랩', () => {
  it('첫 호출이 기본 채널을 만들고 뷰어를 참여시킨다', async () => {
    const channelId = await ensureDefaultChannel(ORG_A, USER_OWNER);

    const channel = await getChannel(ORG_A, owner, channelId);
    expect(channel).toMatchObject({ name: '일반', isDefault: true, isPrivate: false, isMember: true });
  });

  it('여러 번 불러도 채널은 하나다 (멱등)', async () => {
    const first = await ensureDefaultChannel(ORG_A, USER_OWNER);
    const second = await ensureDefaultChannel(ORG_A, USER_OTHER);

    expect(second).toBe(first);
    expect(await prisma.channel.count({ where: { orgId: ORG_A } })).toBe(1);
    expect(await prisma.channelMember.count({ where: { channelId: first } })).toBe(2);
  });

  it('org 미러가 아직 없어도 부트스트랩된다 (웹훅 지연 경합)', async () => {
    await prisma.organization.deleteMany({});

    const channelId = await ensureDefaultChannel(ORG_A, USER_OWNER);

    expect(await prisma.organization.count({ where: { id: ORG_A } })).toBe(1);
    expect(await prisma.channel.count({ where: { id: channelId } })).toBe(1);
  });

  it("누가 '일반'이라는 이름을 먼저 가져갔어도 기본 채널이 보장된다", async () => {
    // UI 흐름으론 불가능하지만 Server Action 직접 호출로는 가능한 경로. 그대로 두면
    // 기본 채널을 영영 만들 수 없어 그 워크스페이스의 /chat이 통째로 죽는다.
    const usurper = await makeChannel(ORG_A, USER_OTHER, '일반');

    const channelId = await ensureDefaultChannel(ORG_A, USER_OWNER);

    expect(channelId).toBe(usurper);
    expect(await getChannel(ORG_A, owner, channelId)).toMatchObject({
      isDefault: true,
      isMember: true,
    });
    expect(await prisma.channel.count({ where: { orgId: ORG_A } })).toBe(1);
  });
});

describe("기본 채널 승격 — 비공개 채널이 '일반'을 점유한 경우 (KAN-53)", () => {
  it('비공개 채널은 승격되지 않고, 조직 전원이 강제 참여되지도 않는다', async () => {
    const secret = await squatDefaultName(ORG_A, USER_OTHER);

    const channelId = await ensureDefaultChannel(ORG_A, USER_OWNER);

    // 점유한 비공개 채널은 그대로 남의 방이어야 한다.
    expect(channelId).not.toBe(secret);
    expect(await getChannel(ORG_A, owner, secret)).toBeNull();
    expect(
      await prisma.channelMember.count({ where: { channelId: secret, userId: USER_OWNER } }),
    ).toBe(0);
    const squatter = await prisma.channel.findUniqueOrThrow({ where: { id: secret } });
    expect(squatter).toMatchObject({ isDefault: false, isPrivate: true });
  });

  it('이름을 양보하고 대체 이름으로 기본 채널을 만든다 — /chat이 죽지 않는다', async () => {
    await squatDefaultName(ORG_A, USER_OTHER);

    const channelId = await ensureDefaultChannel(ORG_A, USER_OWNER);

    expect(await getChannel(ORG_A, owner, channelId)).toMatchObject({
      name: '일반-2',
      isDefault: true,
      isPrivate: false,
      isMember: true,
    });
  });

  it('대체 이름도 점유돼 있으면 다음 후보로 넘어간다', async () => {
    await squatDefaultName(ORG_A, USER_OTHER);
    await makeChannel(ORG_A, USER_OTHER, '일반-2');

    const channelId = await ensureDefaultChannel(ORG_A, USER_OWNER);

    expect(await getChannel(ORG_A, owner, channelId)).toMatchObject({
      name: '일반-3',
      isDefault: true,
    });
  });

  it('여러 번 불러도 기본 채널은 하나다 (멱등)', async () => {
    await squatDefaultName(ORG_A, USER_OTHER);

    const first = await ensureDefaultChannel(ORG_A, USER_OWNER);
    const second = await ensureDefaultChannel(ORG_A, USER_OTHER);

    expect(second).toBe(first);
    expect(await prisma.channel.count({ where: { orgId: ORG_A, isDefault: true } })).toBe(1);
  });

  it("점유하던 비공개 채널이 지워져도 '일반'을 새로 만들어 기본 채널을 둘로 가르지 않는다", async () => {
    const secret = await squatDefaultName(ORG_A, USER_OTHER);
    const fallback = await ensureDefaultChannel(ORG_A, USER_OWNER);

    await prisma.channel.delete({ where: { id: secret } });
    const again = await ensureDefaultChannel(ORG_A, USER_OWNER);

    expect(again).toBe(fallback);
    expect(await prisma.channel.count({ where: { orgId: ORG_A, isDefault: true } })).toBe(1);
  });

  it('비공개 채널은 애초에 기본 채널 이름을 가져갈 수 없다', async () => {
    const outcome = await createChannel(ORG_A, USER_OTHER, {
      name: '일반',
      topic: null,
      isPrivate: true,
    });

    expect(outcome).toEqual({ status: 'reserved' });
    expect(await prisma.channel.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('개명으로도 가져갈 수 없다 — 두 걸음으로 예약 가드를 우회하지 못한다', async () => {
    const secret = await makeChannel(ORG_A, USER_OTHER, '비밀', true);

    const outcome = await updateChannel(ORG_A, other, secret, { name: '일반', topic: null });

    expect(outcome).toEqual({ status: 'reserved' });
    expect(await prisma.channel.findUniqueOrThrow({ where: { id: secret } })).toMatchObject({
      name: '비밀',
    });
  });

  it('이미 그 이름인 비공개 채널이라도 주제는 바꿀 수 있다', async () => {
    const secret = await squatDefaultName(ORG_A, USER_OTHER);

    const outcome = await updateChannel(ORG_A, other, secret, { name: '일반', topic: '주제' });

    expect(outcome).toMatchObject({ status: 'ok', channel: { topic: '주제' } });
  });

  it('공개 채널이라면 기본 채널 이름을 써도 되고, 그대로 승격된다', async () => {
    const open = await makeChannel(ORG_A, USER_OTHER, '일반');

    expect(await ensureDefaultChannel(ORG_A, USER_OWNER)).toBe(open);
  });
});

describe('멀티테넌시 격리', () => {
  it('listChannels는 자기 워크스페이스의 채널만 반환한다', async () => {
    await makeChannel(ORG_A, USER_OWNER, 'a-채널');
    await makeChannel(ORG_B, USER_OTHER, 'b-채널');

    expect((await listChannels(ORG_A, owner)).map((c) => c.name)).toEqual(['a-채널']);
    expect((await listChannels(ORG_B, other)).map((c) => c.name)).toEqual(['b-채널']);
  });

  it('남의 워크스페이스 채널은 id를 알아도 조회·수정·삭제가 안 된다', async () => {
    const foreign = await makeChannel(ORG_B, USER_OTHER, 'b-채널');

    expect(await getChannel(ORG_A, owner, foreign)).toBeNull();
    expect(await updateChannel(ORG_A, owner, foreign, { name: '탈취', topic: null })).toEqual({
      status: 'notfound',
    });
    expect(await deleteChannel(ORG_A, owner, foreign)).toBe('notfound');
    // admin이어도 남의 워크스페이스에는 손댈 수 없다 — org 스코프가 먼저다.
    expect(await deleteChannel(ORG_A, admin, foreign)).toBe('notfound');
    expect(await prisma.channel.count({ where: { id: foreign } })).toBe(1);
  });

  it('같은 이름의 채널은 워크스페이스마다 따로 존재한다', async () => {
    await makeChannel(ORG_A, USER_OWNER, '공지');
    const outcome = await createChannel(ORG_B, USER_OTHER, {
      name: '공지',
      topic: null,
      isPrivate: false,
    });
    expect(outcome.status).toBe('ok');
  });

  it('한 워크스페이스 안에서는 이름이 유일하다', async () => {
    await makeChannel(ORG_A, USER_OWNER, '공지');
    const outcome = await createChannel(ORG_A, USER_OTHER, {
      name: '공지',
      topic: null,
      isPrivate: false,
    });
    expect(outcome.status).toBe('duplicate');
  });
});

describe('비공개 채널 접근', () => {
  it('참여자가 아니면 목록에도 단건 조회에도 뜨지 않는다', async () => {
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);

    expect((await listChannels(ORG_A, other)).map((c) => c.name)).toEqual([]);
    expect(await getChannel(ORG_A, other, secret)).toBeNull();
    // 생성자에게는 보인다.
    expect(await getChannel(ORG_A, owner, secret)).toMatchObject({ isPrivate: true, isMember: true });
  });

  it('admin이라도 참여하지 않은 비공개 채널은 볼 수 없다', async () => {
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);

    expect(await getChannel(ORG_A, admin, secret)).toBeNull();
    expect(await deleteChannel(ORG_A, admin, secret)).toBe('notfound');
  });

  it('스스로 참여할 수 없고, 초대되면 보인다', async () => {
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);
    await seedMemberships();

    expect(await joinChannel(ORG_A, USER_OTHER, secret)).toBe(false);
    expect(await inviteToChannel(ORG_A, USER_OWNER, secret, USER_OTHER)).toBe(true);
    expect(await getChannel(ORG_A, other, secret)).toMatchObject({ isMember: true });
  });

  it('마지막 참여자는 나갈 수 없다 — 아무도 못 보는 채널을 만들지 않는다', async () => {
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);

    expect(await leaveChannel(ORG_A, USER_OWNER, secret)).toBe(false);
    expect(await getChannel(ORG_A, owner, secret)).toMatchObject({ isMember: true });

    // 둘 이상이면 나갈 수 있다.
    await seedMemberships();
    await inviteToChannel(ORG_A, USER_OWNER, secret, USER_OTHER);
    expect(await leaveChannel(ORG_A, USER_OWNER, secret)).toBe(true);
    expect(await getChannel(ORG_A, owner, secret)).toBeNull();
  });

  it('참여자가 아니면 초대할 수 없다', async () => {
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);
    await seedMemberships();

    expect(await inviteToChannel(ORG_A, USER_OTHER, secret, USER_ADMIN)).toBe(false);
  });

  it('공개 채널에는 초대할 수 없다 — 참여는 스스로 하는 것이다', async () => {
    const open = await makeChannel(ORG_A, USER_OWNER, '잡담');
    await seedMemberships();

    expect(await inviteToChannel(ORG_A, USER_OWNER, open, USER_OTHER)).toBe(false);
    expect(await prisma.channelMember.count({ where: { channelId: open, userId: USER_OTHER } })).toBe(
      0,
    );
  });

  it('삭제된 계정의 stale 세션은 초대할 수 없다', async () => {
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);
    await seedMemberships();
    await prisma.clerkTombstone.create({ data: { id: USER_OWNER } });

    await expect(inviteToChannel(ORG_A, USER_OWNER, secret, USER_OTHER)).rejects.toThrow();
    expect(
      await prisma.channelMember.count({ where: { channelId: secret, userId: USER_OTHER } }),
    ).toBe(0);
  });

  it('다른 워크스페이스 사람은 초대할 수 없다', async () => {
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);
    await prisma.membership.create({
      data: { id: 'mem_b_only', orgId: ORG_B, userId: USER_ADMIN, role: 'org:member' },
    });

    expect(await inviteToChannel(ORG_A, USER_OWNER, secret, USER_ADMIN)).toBe(false);
  });
});

describe('접근 판정만 하는 경량 조회 (KAN-34)', () => {
  // Pusher 채널 인증과 타이핑 핑이 쓰는 문이다 — 여기가 getChannel보다 느슨하면
  // 비공개 채널의 실시간 경로가 통째로 열린다. 두 함수의 판정이 늘 같아야 한다.
  it('getChannel이 보여주는 것과 정확히 같은 것만 통과시킨다', async () => {
    const open = await makeChannel(ORG_A, USER_OWNER, '공개', false);
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);

    // 공개 채널은 참여하지 않아도 접근된다(누구나 읽을 수 있으므로).
    expect(await canAccessChannel(ORG_A, USER_OTHER, open)).toBe(true);
    // 비공개 채널은 참여자만. admin도 예외가 아니다.
    expect(await canAccessChannel(ORG_A, USER_OWNER, secret)).toBe(true);
    expect(await canAccessChannel(ORG_A, USER_OTHER, secret)).toBe(false);
    expect(await canAccessChannel(ORG_A, USER_ADMIN, secret)).toBe(false);
    // 남의 워크스페이스에서는 id를 알아도 안 된다.
    expect(await canAccessChannel(ORG_B, USER_OWNER, open)).toBe(false);
    // 없는 채널도 같은 false — '가려짐'과 '없음'을 구분하지 않는다.
    expect(await canAccessChannel(ORG_A, USER_OWNER, 'no_such_channel')).toBe(false);
  });
});

describe('참여 / 나가기', () => {
  it('공개 채널은 스스로 참여하고 나갈 수 있다', async () => {
    const open = await makeChannel(ORG_A, USER_OWNER, '잡담');

    expect(await joinChannel(ORG_A, USER_OTHER, open)).toBe(true);
    expect(await getChannel(ORG_A, other, open)).toMatchObject({ isMember: true, memberCount: 2 });
    expect(await leaveChannel(ORG_A, USER_OTHER, open)).toBe(true);
    expect(await getChannel(ORG_A, other, open)).toMatchObject({ isMember: false, memberCount: 1 });
  });

  it('기본 채널은 나갈 수 없다', async () => {
    const defaultId = await ensureDefaultChannel(ORG_A, USER_OWNER);

    expect(await leaveChannel(ORG_A, USER_OWNER, defaultId)).toBe(false);
    expect(await prisma.channelMember.count({ where: { channelId: defaultId } })).toBe(1);
  });

  it('남의 워크스페이스 채널에는 참여할 수 없다', async () => {
    const foreign = await makeChannel(ORG_B, USER_OTHER, 'b-채널');

    expect(await joinChannel(ORG_A, USER_OWNER, foreign)).toBe(false);
    expect(await prisma.channelMember.count({ where: { channelId: foreign, userId: USER_OWNER } })).toBe(0);
  });

  it('초대 후보는 아직 참여하지 않은 워크스페이스 멤버뿐이다', async () => {
    await seedMemberships();
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);

    // ORG_A 멤버는 owner·other 둘인데 owner는 생성자로 이미 참여 중이다.
    expect((await listInvitableMembers(ORG_A, USER_OWNER, secret))?.map((p) => p.id)).toEqual([
      USER_OTHER,
    ]);
    expect((await listChannelMembers(ORG_A, USER_OWNER, secret))?.map((p) => p.id)).toEqual([
      USER_OWNER,
    ]);
  });

  it('참여자·초대 후보 목록은 접근 권한이 없으면 null이다', async () => {
    await seedMemberships();
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);

    expect(await listChannelMembers(ORG_A, USER_OTHER, secret)).toBeNull();
    expect(await listInvitableMembers(ORG_A, USER_OTHER, secret)).toBeNull();
  });
});

describe('채널 관리 권한 (KAN-18 규칙 상속)', () => {
  it('만든 사람은 이름·주제를 바꾸고 삭제할 수 있다', async () => {
    const id = await makeChannel(ORG_A, USER_OWNER, '공지');

    const updated = await updateChannel(ORG_A, owner, id, { name: '공지사항', topic: '릴리스' });
    expect(updated).toMatchObject({ status: 'ok', channel: { name: '공지사항', topic: '릴리스' } });
    expect(await deleteChannel(ORG_A, owner, id)).toBe('ok');
  });

  it('만들지 않은 사람은 바꾸거나 지울 수 없다', async () => {
    const id = await makeChannel(ORG_A, USER_OWNER, '공지');

    expect(await updateChannel(ORG_A, other, id, { name: '탈취', topic: null })).toEqual({
      status: 'forbidden',
    });
    expect(await deleteChannel(ORG_A, other, id)).toBe('forbidden');
    expect(await prisma.channel.count({ where: { id, name: '공지' } })).toBe(1);
  });

  it('admin은 같은 워크스페이스의 공개 채널을 관리할 수 있다', async () => {
    const id = await makeChannel(ORG_A, USER_OWNER, '공지');

    expect(await updateChannel(ORG_A, admin, id, { name: '공지', topic: '관리자 수정' })).toMatchObject({
      status: 'ok',
    });
    expect(await deleteChannel(ORG_A, admin, id)).toBe('ok');
  });

  it('기본 채널은 이름 변경도 삭제도 거부된다 (주제는 바꿀 수 있다)', async () => {
    const defaultId = await ensureDefaultChannel(ORG_A, USER_OWNER);

    expect(await updateChannel(ORG_A, admin, defaultId, { name: '이름변경', topic: null })).toEqual({
      status: 'default',
    });
    expect(await deleteChannel(ORG_A, admin, defaultId)).toBe('default');
    expect(
      await updateChannel(ORG_A, admin, defaultId, { name: '일반', topic: '새 주제' }),
    ).toMatchObject({ status: 'ok', channel: { topic: '새 주제' } });
  });

  it('이름을 이미 있는 채널과 같게 바꿀 수 없다', async () => {
    await makeChannel(ORG_A, USER_OWNER, '공지');
    const id = await makeChannel(ORG_A, USER_OWNER, '잡담');

    expect(await updateChannel(ORG_A, owner, id, { name: '공지', topic: null })).toEqual({
      status: 'duplicate',
    });
  });
});

describe('수명 정책 · tombstone 가드', () => {
  it('조직을 지우면 채널과 참여 기록도 파기된다', async () => {
    await makeChannel(ORG_A, USER_OWNER, '공지');
    await makeChannel(ORG_B, USER_OTHER, 'b-채널');

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.channel.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.channelMember.count({ where: { userId: USER_OWNER } })).toBe(0);
    expect(await prisma.channel.count({ where: { orgId: ORG_B } })).toBe(1);
  });

  it('조직에서 빠지면 그 조직 채널의 참여도 사라진다 (재초대 시 접근 부활 방지)', async () => {
    await seedMemberships();
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);
    await inviteToChannel(ORG_A, USER_OWNER, secret, USER_OTHER);
    // 다른 워크스페이스의 참여는 건드리면 안 된다.
    const foreign = await makeChannel(ORG_B, USER_OTHER, 'b-채널');

    await deleteMembership({ membershipId: 'mem_a_other', orgId: ORG_A, userId: USER_OTHER });

    expect(await getChannel(ORG_A, other, secret)).toBeNull();
    expect(await prisma.channelMember.count({ where: { channelId: secret } })).toBe(1);
    expect(
      await prisma.channelMember.count({ where: { channelId: foreign, userId: USER_OTHER } }),
    ).toBe(1);
  });

  it('미러 행이 재키잉돼 있어도 채널 참여는 정리된다 (KAN-54 · 재초대 경합)', async () => {
    await seedMemberships();
    const secret = await makeChannel(ORG_A, USER_OWNER, '비밀', true);
    await inviteToChannel(ORG_A, USER_OWNER, secret, USER_OTHER);
    // 재초대의 created가 지연된 deleted보다 먼저 도착한 상태 — upsertMembership이 같은
    // (orgId,userId) 행의 id를 새 멤버십 id로 덮어썼다. 옛 id로는 행을 찾을 수 없다.
    await prisma.membership.update({
      where: { id: 'mem_a_other' },
      data: { id: 'mem_a_other_2' },
    });

    await deleteMembership({ membershipId: 'mem_a_other', orgId: ORG_A, userId: USER_OTHER });

    // 탈퇴 기간의 비공개 대화가 재초대로 되살아나면 안 된다.
    expect(await getChannel(ORG_A, other, secret)).toBeNull();
    // 지금 유효한 재초대 멤버십은 옛 삭제 이벤트에 휩쓸리지 않는다.
    expect(await prisma.membership.count({ where: { id: 'mem_a_other_2' } })).toBe(1);
  });

  it('미러 행이 아예 없어도 채널 참여는 정리된다 (KAN-54 · created 웹훅 유실)', async () => {
    // createChannel은 Membership 미러를 보지 않는다 — created 웹훅이 유실된 사용자도
    // 세션의 orgId만으로 비공개 채널을 만들고 참여자가 되어 있을 수 있다.
    const secret = await makeChannel(ORG_A, USER_OTHER, '비밀', true);
    expect(await prisma.membership.count({ where: { orgId: ORG_A } })).toBe(0);

    await deleteMembership({ membershipId: 'mem_a_other', orgId: ORG_A, userId: USER_OTHER });

    expect(await prisma.channelMember.count({ where: { channelId: secret } })).toBe(0);
  });

  it('사용자를 지우면 참여만 사라지고 채널은 남는다', async () => {
    const id = await makeChannel(ORG_A, USER_OWNER, '공지');

    await prisma.user.delete({ where: { id: USER_OWNER } });

    const channel = await prisma.channel.findUnique({ where: { id } });
    expect(channel?.createdById).toBeNull();
    expect(await prisma.channelMember.count({ where: { channelId: id } })).toBe(0);
  });

  it('삭제된 org로는 채널을 만들 수 없고 스켈레톤도 부활하지 않는다', async () => {
    await prisma.organization.delete({ where: { id: ORG_A } });
    await prisma.clerkTombstone.create({ data: { id: ORG_A } });

    await expect(
      createChannel(ORG_A, USER_OWNER, { name: '유령', topic: null, isPrivate: false }),
    ).rejects.toThrow();

    expect(await prisma.organization.count({ where: { id: ORG_A } })).toBe(0);
    expect(await prisma.channel.count()).toBe(0);
  });

  it('삭제된 사용자로는 기본 채널 부트스트랩도 막힌다', async () => {
    await prisma.user.delete({ where: { id: USER_OWNER } });
    await prisma.clerkTombstone.create({ data: { id: USER_OWNER } });

    await expect(ensureDefaultChannel(ORG_A, USER_OWNER)).rejects.toThrow();

    expect(await prisma.channel.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.channelMember.count()).toBe(0);
  });

  it('삭제된 사용자로는 공개 채널에 참여할 수 없다', async () => {
    const open = await makeChannel(ORG_A, USER_OWNER, '잡담');
    await prisma.user.delete({ where: { id: USER_OTHER } });
    await prisma.clerkTombstone.create({ data: { id: USER_OTHER } });

    await expect(joinChannel(ORG_A, USER_OTHER, open)).rejects.toThrow();

    expect(await prisma.channelMember.count({ where: { userId: USER_OTHER } })).toBe(0);
  });
});
