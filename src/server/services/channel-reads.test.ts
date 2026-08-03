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
  seedMessages,
  seedTenants,
} from '../../../test/db';
import { createMessage } from './chat';
import { markChannelRead, unreadCounts } from './channel-reads';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
  await seedChannels();
});

/**
 * 안읽음은 '참여한 채널'만 센다. 기준선은 참여 시각이 아니라 **그 순간의 채널 순번**이다
 * (KAN-55) — 참여 시각과 메시지 시각은 서로 다른 프로세스의 시계라 비교할 근거가 없었다.
 */
async function join(channelId: string, userId: string) {
  const { messageSeq } = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: { messageSeq: true },
  });
  await prisma.channelMember.create({ data: { channelId, userId, joinedSeq: messageSeq } });
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
    await join(CHANNEL_A, USER_OWNER);
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

  it('createdAt이 전부 같아도 커서가 경계에서 흔들리지 않는다 (KAN-55)', async () => {
    // 시각이 기준이던 시절 이 케이스는 경계에서 한 건이 빠지거나 두 번 세어졌다.
    // 순번은 같은 값이 나올 수 없어 경계가 애초에 모호하지 않다.
    await join(CHANNEL_A, USER_OWNER);
    const sameMoment = new Date('2026-03-01T00:00:00.000Z');
    await seedMessages(
      ['ma', 'mb', 'mc'].map((id) => ({
        id,
        orgId: ORG_A,
        channelId: CHANNEL_A,
        authorId: USER_OTHER,
        body: id,
        createdAt: sameMoment,
      })),
    );

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

describe('자체 리뷰 반영 (KAN-33)', () => {
  it('나갔다 다시 들어오면 그 사이 대화는 안읽음이 아니다', async () => {
    // leaveChannel은 참여 행만 지우고 읽음 커서는 남긴다. 그 옛 커서를 그대로 믿으면
    // 내가 없던 동안의 대화가 통째로 안읽음으로 되살아난다.
    await join(CHANNEL_A, USER_OWNER);
    const first = await say(CHANNEL_A, USER_OTHER, '있을 때 한 말');
    await markChannelRead(ORG_A, USER_OWNER, CHANNEL_A, first.id);

    await prisma.channelMember.deleteMany({ where: { channelId: CHANNEL_A, userId: USER_OWNER } });
    await say(CHANNEL_A, USER_OTHER, '없는 동안 1');
    await say(CHANNEL_A, USER_OTHER, '없는 동안 2');
    await join(CHANNEL_A, USER_OWNER);

    expect((await unreadCounts(ORG_A, USER_OWNER)).get(CHANNEL_A)).toBeUndefined();
  });

  it('답글 id로는 커서를 세울 수 없다', async () => {
    // 답글은 채널 본문에 없는데 createdAt은 뒤다 — 답글로 커서를 세우면 아직 안 읽은
    // 루트 메시지들을 건너뛴다.
    await join(CHANNEL_A, USER_OWNER);
    const root = await say(CHANNEL_A, USER_OTHER, '루트');
    const reply = await createMessage(ORG_A, USER_OTHER, CHANNEL_A, '답글', root.id);

    expect(await markChannelRead(ORG_A, USER_OWNER, CHANNEL_A, reply!.message.id)).toBe(false);
    expect(await prisma.channelRead.count()).toBe(0);
  });

  it('참여하지 않은 공개 채널에는 커서를 세우지 않는다', async () => {
    // unreadCounts가 참여 채널만 세므로, 여기서 허용하면 둘러보기만 한 채널마다
    // 아무도 안 읽는 행이 쌓인다. 두 함수의 대상 집합을 맞춘다.
    const open = await prisma.channel.create({ data: { orgId: ORG_A, name: '잡담' } });
    const message = await say(open.id, USER_OTHER, '둘러보기');

    expect(await markChannelRead(ORG_A, USER_OWNER, open.id, message.id)).toBe(false);
    await join(open.id, USER_OWNER);
    expect(await markChannelRead(ORG_A, USER_OWNER, open.id, message.id)).toBe(true);
  });

  it('참여 직후에 온 메시지는 빠짐없이 센다', async () => {
    // 시각으로 비교하던 시절의 경계 사고 — 참여 행과 같은 ms에 들어온 메시지가 조용히
    // 빠졌다. 참여 기준선이 '그때까지 나온 마지막 순번'이라 그 뒤는 전부 안읽음이다.
    const at = new Date('2026-05-01T00:00:00.000Z');
    await join(CHANNEL_A, USER_OWNER);
    await seedMessages([
      { id: 'same_ms', orgId: ORG_A, channelId: CHANNEL_A, authorId: USER_OTHER, body: '동시', createdAt: at },
    ]);

    expect((await unreadCounts(ORG_A, USER_OWNER)).get(CHANNEL_A)).toBe(1);
  });
});
