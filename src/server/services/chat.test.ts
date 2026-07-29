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
import { createMessage, listMessages } from './chat';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
  await seedChannels();
});

describe('멀티테넌시 격리', () => {
  it('listMessages는 자기 org·자기 채널의 메시지만 반환한다', async () => {
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, 'A의 메시지');
    await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B의 메시지');

    expect((await listMessages(ORG_A, USER_OWNER, CHANNEL_A)).map((m) => m.body)).toEqual([
      'A의 메시지',
    ]);
    expect((await listMessages(ORG_B, USER_OTHER, CHANNEL_B)).map((m) => m.body)).toEqual([
      'B의 메시지',
    ]);
  });

  it('남의 워크스페이스 채널 id를 알아도 읽지도 쓰지도 못한다', async () => {
    await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B의 비밀');

    // 내 org로 스코프한 채 남의 채널 id를 넘기는 경로 — 조회는 비고, 전송은 거부된다.
    expect(await listMessages(ORG_A, USER_OWNER, CHANNEL_B)).toEqual([]);
    expect(await createMessage(ORG_A, USER_OWNER, CHANNEL_B, '끼어들기')).toBeNull();
    expect(await prisma.chatMessage.count({ where: { channelId: CHANNEL_B } })).toBe(1);
  });

  it('채널이 다르면 메시지가 섞이지 않는다', async () => {
    const other = await prisma.channel.create({ data: { orgId: ORG_A, name: '공지' } });
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '일반의 말');
    await createMessage(ORG_A, USER_OWNER, other.id, '공지의 말');

    expect((await listMessages(ORG_A, USER_OWNER, CHANNEL_A)).map((m) => m.body)).toEqual([
      '일반의 말',
    ]);
    expect((await listMessages(ORG_A, USER_OWNER, other.id)).map((m) => m.body)).toEqual([
      '공지의 말',
    ]);
  });

  it('오래된 것부터 시간순으로 반환한다', async () => {
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '첫 번째');
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '두 번째');
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '세 번째');

    expect((await listMessages(ORG_A, USER_OWNER, CHANNEL_A)).map((m) => m.body)).toEqual([
      '첫 번째',
      '두 번째',
      '세 번째',
    ]);
  });
});

describe('비공개 채널 (KAN-28)', () => {
  it('참여하지 않은 비공개 채널은 읽을 수도 쓸 수도 없다', async () => {
    const secret = await prisma.channel.create({
      data: {
        orgId: ORG_A,
        name: '비밀',
        isPrivate: true,
        members: { create: { userId: USER_OWNER } },
      },
    });
    await createMessage(ORG_A, USER_OWNER, secret.id, '멤버끼리 하는 말');

    // 같은 워크스페이스라도 참여자가 아니면 존재하지 않는 것과 같다.
    expect(await listMessages(ORG_A, USER_OTHER, secret.id)).toEqual([]);
    expect(await createMessage(ORG_A, USER_OTHER, secret.id, '엿듣기')).toBeNull();
    // 참여자에게는 그대로 보인다.
    expect((await listMessages(ORG_A, USER_OWNER, secret.id)).map((m) => m.body)).toEqual([
      '멤버끼리 하는 말',
    ]);
  });

  it('공개 채널에 처음 말하면 자동으로 참여된다 (슬랙식)', async () => {
    const open = await prisma.channel.create({ data: { orgId: ORG_A, name: '잡담' } });
    expect(await prisma.channelMember.count({ where: { channelId: open.id } })).toBe(0);

    await createMessage(ORG_A, USER_OTHER, open.id, '안녕하세요');

    expect(
      await prisma.channelMember.count({ where: { channelId: open.id, userId: USER_OTHER } }),
    ).toBe(1);
  });
});

describe('작성자 표시', () => {
  it('미러에 사용자가 있으면 이름을, 없으면 id를 쓴다', async () => {
    await prisma.user.update({
      where: { id: USER_OWNER },
      data: { firstName: '단', lastName: '강' },
    });
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '이름 있는 사람');
    // 웹훅이 아직 안 온 사용자 — 미러 행이 없다(스켈레톤만 생긴다).
    await createMessage(ORG_A, 'user_not_mirrored_yet', CHANNEL_A, '아직 동기화 전');

    const [named, unnamed] = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);
    expect(named.authorName).toBe('단 강');
    expect(unnamed.authorName).toBe('user_not_mirrored_yet');
  });
});

describe('테넌트 수명 (KAN-19 · KAN-28)', () => {
  it('조직을 지우면 그 조직의 채널·메시지도 함께 파기된다', async () => {
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, 'A-1');
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, 'A-2');
    await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B-1');

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.channel.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.chatMessage.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.chatMessage.count({ where: { orgId: ORG_B } })).toBe(1);
  });

  it('채널을 지우면 그 채널의 대화만 파기된다', async () => {
    const other = await prisma.channel.create({ data: { orgId: ORG_A, name: '공지' } });
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '남을 말');
    await createMessage(ORG_A, USER_OWNER, other.id, '사라질 말');

    await prisma.channel.delete({ where: { id: other.id } });

    expect(await prisma.chatMessage.count({ where: { orgId: ORG_A } })).toBe(1);
    expect((await listMessages(ORG_A, USER_OWNER, CHANNEL_A)).map((m) => m.body)).toEqual([
      '남을 말',
    ]);
  });

  it('삭제된 org로는 전송할 수 없고, org 스켈레톤도 부활하지 않는다', async () => {
    await prisma.organization.delete({ where: { id: ORG_A } });
    await prisma.clerkTombstone.create({ data: { id: ORG_A } });

    // 채널도 cascade로 사라졌으므로 접근 확인에서 먼저 걸린다.
    expect(await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '유령 메시지')).toBeNull();

    expect(await prisma.organization.count({ where: { id: ORG_A } })).toBe(0);
    expect(await prisma.chatMessage.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('삭제된 사용자로는 전송할 수 없다', async () => {
    await prisma.user.delete({ where: { id: USER_OWNER } });
    await prisma.clerkTombstone.create({ data: { id: USER_OWNER } });

    await expect(createMessage(ORG_A, USER_OWNER, CHANNEL_A, '유령이 보낸 말')).rejects.toThrow();

    expect(await prisma.chatMessage.count({ where: { orgId: ORG_A } })).toBe(0);
    // 자동 참여로 되살아난 멤버십도 남지 않는다.
    expect(await prisma.channelMember.count({ where: { userId: USER_OWNER } })).toBe(0);
  });

  it('사용자 미러가 아직 없어도 전송된다 (웹훅 지연 경합)', async () => {
    // user.created가 아직 안 온 새 멤버의 첫 발언. ChannelMember FK 때문에 스켈레톤이
    // 필요하다 — 없으면 자동 참여가 FK 위반으로 죽는다.
    const message = await createMessage(ORG_A, 'user_brand_new', CHANNEL_A, '부트스트랩');

    expect(message?.body).toBe('부트스트랩');
    expect(await prisma.user.count({ where: { id: 'user_brand_new' } })).toBe(1);
    expect(
      await prisma.channelMember.count({ where: { channelId: CHANNEL_A, userId: 'user_brand_new' } }),
    ).toBe(1);
  });
});
