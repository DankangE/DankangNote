import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  CHANNEL_A,
  CHANNEL_B,
  ORG_A,
  ORG_B,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedChannels,
  seedTenants,
} from '../../../test/db';
import { createMessage } from './chat';
import { markChannelRead, unreadCounts } from './channel-reads';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
  await seedChannels();
});

/** 안읽음은 '참여한 채널'만 센다 — 참여 시각이 기준선이라 먼저 넣어 둔다. */
async function join(channelId: string, userId: string, at = new Date('2026-01-01T00:00:00.000Z')) {
  await prisma.channelMember.create({ data: { channelId, userId, createdAt: at } });
}

async function say(channelId: string, authorId: string, body: string) {
  const sent = await createMessage(ORG_A, authorId, channelId, body);
  return sent!.message;
}

describe('안읽음 세기 (KAN-33)', () => {
  it('참여 이후 남이 쓴 메시지를 센다', async () => {
    await join(CHANNEL_A, USER_OWNER);
    await say(CHANNEL_A, USER_OTHER, '하나');
    await say(CHANNEL_A, USER_OTHER, '둘');

    expect((await unreadCounts(ORG_A, USER_OWNER)).get(CHANNEL_A)).toBe(2);
  });

  it('내가 쓴 메시지는 세지 않는다', async () => {
    await join(CHANNEL_A, USER_OWNER);
    await say(CHANNEL_A, USER_OWNER, '내 말');
    await say(CHANNEL_A, USER_OTHER, '남의 말');

    expect((await unreadCounts(ORG_A, USER_OWNER)).get(CHANNEL_A)).toBe(1);
  });

  it('스레드 답글은 세지 않는다', async () => {
    // 답글은 채널 본문에 안 보이므로(KAN-30) 뱃지를 눌러 가도 찾을 수 없다.
    await join(CHANNEL_A, USER_OWNER);
    const root = await say(CHANNEL_A, USER_OTHER, '루트');
    await createMessage(ORG_A, USER_OTHER, CHANNEL_A, '답글', root.id);

    expect((await unreadCounts(ORG_A, USER_OWNER)).get(CHANNEL_A)).toBe(1);
  });

  it('참여 이전의 이력은 안읽음이 아니다', async () => {
    await say(CHANNEL_A, USER_OTHER, '들어오기 전 이야기');
    await join(CHANNEL_A, USER_OWNER, new Date());
    await say(CHANNEL_A, USER_OTHER, '들어온 뒤 이야기');

    expect((await unreadCounts(ORG_A, USER_OWNER)).get(CHANNEL_A)).toBe(1);
  });

  it('참여하지 않은 공개 채널은 아예 세지 않는다', async () => {
    const open = await prisma.channel.create({ data: { orgId: ORG_A, name: '잡담' } });
    await say(open.id, USER_OTHER, '둘러보기 채널의 말');

    expect((await unreadCounts(ORG_A, USER_OWNER)).get(open.id)).toBeUndefined();
  });

  it('읽고 나면 0이고, 그 뒤에 온 것만 다시 센다', async () => {
    await join(CHANNEL_A, USER_OWNER);
    await say(CHANNEL_A, USER_OTHER, '하나');
    const second = await say(CHANNEL_A, USER_OTHER, '둘');

    expect(await markChannelRead(ORG_A, USER_OWNER, CHANNEL_A, second.id)).toBe(true);
    expect((await unreadCounts(ORG_A, USER_OWNER)).get(CHANNEL_A)).toBeUndefined();

    await say(CHANNEL_A, USER_OTHER, '셋');
    expect((await unreadCounts(ORG_A, USER_OWNER)).get(CHANNEL_A)).toBe(1);
  });

  it('createdAt이 같아도 커서가 경계에서 흔들리지 않는다', async () => {
    // 시각만 비교하면 같은 ms에 들어온 메시지가 경계에서 빠지거나 두 번 세어진다.
    await join(CHANNEL_A, USER_OWNER);
    const sameMoment = new Date('2026-03-01T00:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: ['ma', 'mb', 'mc'].map((id) => ({
        id,
        orgId: ORG_A,
        channelId: CHANNEL_A,
        authorId: USER_OTHER,
        body: id,
        createdAt: sameMoment,
      })),
    });

    await markChannelRead(ORG_A, USER_OWNER, CHANNEL_A, 'mb');

    // ma·mb는 읽었고 mc만 남는다.
    expect((await unreadCounts(ORG_A, USER_OWNER)).get(CHANNEL_A)).toBe(1);
  });

  it('채널마다 따로 센다', async () => {
    const other = await prisma.channel.create({ data: { orgId: ORG_A, name: '공지' } });
    await join(CHANNEL_A, USER_OWNER);
    await join(other.id, USER_OWNER);
    await say(CHANNEL_A, USER_OTHER, '일반 1');
    await say(other.id, USER_OTHER, '공지 1');
    await say(other.id, USER_OTHER, '공지 2');

    const counts = await unreadCounts(ORG_A, USER_OWNER);
    expect(counts.get(CHANNEL_A)).toBe(1);
    expect(counts.get(other.id)).toBe(2);
  });
});

describe('읽음 커서 격리·전진 (KAN-33)', () => {
  it('커서는 뒤로 가지 않는다', async () => {
    // 위로 올려 옛 메시지를 보는 동안에도 요청이 나갈 수 있고, 여러 탭이면 순서가 뒤집힌다.
    // 뒤로 물러난 커서는 이미 읽은 것을 안읽음으로 되살린다.
    await join(CHANNEL_A, USER_OWNER);
    const first = await say(CHANNEL_A, USER_OTHER, '하나');
    const second = await say(CHANNEL_A, USER_OTHER, '둘');

    await markChannelRead(ORG_A, USER_OWNER, CHANNEL_A, second.id);
    await markChannelRead(ORG_A, USER_OWNER, CHANNEL_A, first.id);

    expect((await unreadCounts(ORG_A, USER_OWNER)).get(CHANNEL_A)).toBeUndefined();
  });

  it('남의 워크스페이스 채널로는 커서를 세울 수 없다', async () => {
    const foreign = await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B의 말');

    expect(
      await markChannelRead(ORG_A, USER_OWNER, CHANNEL_B, foreign!.message.id),
    ).toBe(false);
    expect(await prisma.channelRead.count()).toBe(0);
  });

  it('그 채널의 메시지가 아니면 커서를 세울 수 없다', async () => {
    const other = await prisma.channel.create({ data: { orgId: ORG_A, name: '공지' } });
    const elsewhere = await say(other.id, USER_OTHER, '공지의 말');

    expect(await markChannelRead(ORG_A, USER_OWNER, CHANNEL_A, elsewhere.id)).toBe(false);
    expect(await prisma.channelRead.count()).toBe(0);
  });

  it('참여하지 않은 비공개 채널로는 커서를 세울 수 없다', async () => {
    const secret = await prisma.channel.create({
      data: { orgId: ORG_A, name: '비밀', isPrivate: true, members: { create: { userId: USER_OTHER } } },
    });
    const message = await say(secret.id, USER_OTHER, '비밀');

    expect(await markChannelRead(ORG_A, USER_OWNER, secret.id, message.id)).toBe(false);
    expect(await markChannelRead(ORG_A, USER_OTHER, secret.id, message.id)).toBe(true);
  });

  it('내 안읽음만 보이고 남의 커서에 영향받지 않는다', async () => {
    await join(CHANNEL_A, USER_OWNER);
    await join(CHANNEL_A, USER_OTHER);
    const message = await say(CHANNEL_A, USER_OWNER, '단체 공지');

    // 보낸 사람은 자기 말이라 0, 받는 사람은 1.
    expect((await unreadCounts(ORG_A, USER_OWNER)).get(CHANNEL_A)).toBeUndefined();
    expect((await unreadCounts(ORG_A, USER_OTHER)).get(CHANNEL_A)).toBe(1);

    await markChannelRead(ORG_A, USER_OTHER, CHANNEL_A, message.id);
    expect((await unreadCounts(ORG_A, USER_OTHER)).get(CHANNEL_A)).toBeUndefined();
  });

  it('채널을 지우면 그 읽음 커서도 함께 파기된다', async () => {
    const other = await prisma.channel.create({ data: { orgId: ORG_A, name: '공지' } });
    const message = await say(other.id, USER_OTHER, '공지');
    await markChannelRead(ORG_A, USER_OWNER, other.id, message.id);

    await prisma.channel.delete({ where: { id: other.id } });

    expect(await prisma.channelRead.count()).toBe(0);
  });

  it('조직을 지우면 그 조직의 읽음 커서도 함께 파기된다', async () => {
    const message = await say(CHANNEL_A, USER_OTHER, '말');
    await markChannelRead(ORG_A, USER_OWNER, CHANNEL_A, message.id);

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.channelRead.count()).toBe(0);
  });
});
