import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  CHANNEL_A,
  CHANNEL_B,
  ORG_A,
  ORG_B,
  USER_ADMIN,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedChannels,
  seedMemberships,
  seedTenants,
} from '../../../test/db';
import { createMessage } from './chat';
import { listNotifications, markRead, unreadCount } from './notifications';
import type { MentionSpan } from '@/features/chat/mentions';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
  await seedChannels();
  await seedMemberships();
  // 표시 이름이 있어야 멘션 스팬 검증(본문의 '@이름')이 의미를 갖는다.
  await prisma.user.update({ where: { id: USER_OTHER }, data: { firstName: '김', lastName: '주니' } });
  await prisma.user.update({ where: { id: USER_OWNER }, data: { firstName: '단', lastName: '강' } });
});

/** '@김 주니'가 본문 어디에 있는지 그대로 계산해 주는 헬퍼. */
function span(body: string, label: string, userId: string | null, kind: 'user' | 'channel' = 'user'): MentionSpan {
  const start = body.indexOf(`@${label}`);
  if (start < 0) throw new Error(`본문에 @${label}이 없다`);
  return { kind, userId, start, length: label.length + 1 };
}

describe('멘션 확정 (KAN-32)', () => {
  it('본문에 정말 적힌 멘션만 알림이 된다', async () => {
    const body = '@김 주니 이것 좀 봐주세요';
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, body, undefined, [
      span(body, '김 주니', USER_OTHER),
    ]);

    expect(sent?.notified).toEqual([USER_OTHER]);
    // '@김 주니' = 5자(@ + 이름 4자).
    expect(sent?.message.mentions).toEqual([
      { kind: 'user', userId: USER_OTHER, start: 0, length: 5 },
    ]);
    expect(await unreadCount(ORG_A, USER_OTHER)).toBe(1);
  });

  it('본문에 없는 사람을 멘션했다고 주장해도 알림이 생기지 않는다', async () => {
    // 스팬 검증이 없으면 아무 본문에나 userId를 실어 조직 전체를 호출할 수 있다.
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '안녕하세요', undefined, [
      { kind: 'user', userId: USER_OTHER, start: 0, length: 5 },
    ]);

    expect(sent?.notified).toEqual([]);
    expect(sent?.message.mentions).toEqual([]);
    expect(await unreadCount(ORG_A, USER_OTHER)).toBe(0);
  });

  it('남의 워크스페이스 사람은 멘션해도 알림이 가지 않는다', async () => {
    // USER_ADMIN은 ORG_A의 Membership이 없다(seedMemberships 참조).
    const body = '@user_admin 봐주세요';
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, body, undefined, [
      span(body, 'user_admin', USER_ADMIN),
    ]);

    expect(sent?.notified).toEqual([]);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('자기 자신을 멘션해도 알림은 생기지 않는다', async () => {
    const body = '@단 강 혼잣말';
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, body, undefined, [
      span(body, '단 강', USER_OWNER),
    ]);

    // 멘션 강조는 남지만 알림은 없다.
    expect(sent?.message.mentions).toHaveLength(1);
    expect(sent?.notified).toEqual([]);
  });

  it('같은 사람을 두 번 멘션해도 알림은 하나다', async () => {
    const body = '@김 주니 그리고 @김 주니';
    const first = span(body, '김 주니', USER_OTHER);
    const second = { ...first, start: body.lastIndexOf('@김 주니') };
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, body, undefined, [first, second]);

    expect(sent?.message.mentions).toHaveLength(2);
    expect(await unreadCount(ORG_A, USER_OTHER)).toBe(1);
  });

  it('@channel은 채널 참여자 전체를 부르고 보낸 사람은 뺀다', async () => {
    await prisma.channelMember.createMany({
      data: [
        { channelId: CHANNEL_A, userId: USER_OWNER },
        { channelId: CHANNEL_A, userId: USER_OTHER },
      ],
    });
    const body = '@channel 공지입니다';
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, body, undefined, [
      span(body, 'channel', null, 'channel'),
    ]);

    expect(sent?.notified).toEqual([USER_OTHER]);
  });
});

describe('알림 격리·가시성 (KAN-32)', () => {
  async function mentionOther(channelId: string) {
    const body = '@김 주니 확인 부탁';
    return createMessage(ORG_A, USER_OWNER, channelId, body, undefined, [
      span(body, '김 주니', USER_OTHER),
    ]);
  }

  it('내 알림만 보이고 남의 알림은 목록에도 카운트에도 없다', async () => {
    await mentionOther(CHANNEL_A);

    expect((await listNotifications(ORG_A, USER_OTHER)).notifications).toHaveLength(1);
    expect((await listNotifications(ORG_A, USER_OWNER)).notifications).toEqual([]);
    expect(await unreadCount(ORG_A, USER_OWNER)).toBe(0);
  });

  it('다른 워크스페이스에서는 내 알림이 보이지 않는다', async () => {
    await mentionOther(CHANNEL_A);

    expect((await listNotifications(ORG_B, USER_OTHER)).notifications).toEqual([]);
    expect(await unreadCount(ORG_B, USER_OTHER)).toBe(0);
  });

  it('볼 수 없게 된 비공개 채널의 알림은 목록과 카운트에서 함께 사라진다', async () => {
    const secret = await prisma.channel.create({
      data: {
        orgId: ORG_A,
        name: '비밀',
        isPrivate: true,
        members: { create: [{ userId: USER_OWNER }, { userId: USER_OTHER }] },
      },
    });
    await mentionOther(secret.id);
    expect(await unreadCount(ORG_A, USER_OTHER)).toBe(1);

    // 채널에서 빠지면 발췌를 계속 보여줄 수 없다.
    await prisma.channelMember.deleteMany({ where: { channelId: secret.id, userId: USER_OTHER } });

    expect((await listNotifications(ORG_A, USER_OTHER)).notifications).toEqual([]);
    expect(await unreadCount(ORG_A, USER_OTHER)).toBe(0);
  });

  it('메시지를 지우면 그 알림도 함께 파기된다', async () => {
    const sent = await mentionOther(CHANNEL_A);

    await prisma.chatMessage.delete({ where: { id: sent!.message.id } });

    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.messageMention.count()).toBe(0);
  });

  it('조직을 지우면 그 조직의 알림·멘션도 함께 파기된다', async () => {
    await mentionOther(CHANNEL_A);
    await createMessage(ORG_B, USER_OTHER, CHANNEL_B, '남의 워크스페이스');

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.messageMention.count()).toBe(0);
  });
});

describe('읽음 처리 (KAN-32)', () => {
  async function mention(body = '@김 주니 봐줘') {
    return createMessage(ORG_A, USER_OWNER, CHANNEL_A, body, undefined, [
      span(body, '김 주니', USER_OTHER),
    ]);
  }

  it('전부 읽음은 안읽음만 세고 두 번 불러도 늘지 않는다', async () => {
    await mention();
    await mention('@김 주니 하나 더');

    expect(await markRead(ORG_A, USER_OTHER)).toBe(2);
    expect(await markRead(ORG_A, USER_OTHER)).toBe(0);
    expect(await unreadCount(ORG_A, USER_OTHER)).toBe(0);
  });

  it('남의 알림 id를 넣어도 읽음 처리되지 않는다', async () => {
    const sent = await mention();
    const notification = await prisma.notification.findFirstOrThrow();

    // 알림의 주인은 USER_OTHER다 — USER_OWNER가 그 id로 부르면 아무 일도 없어야 한다.
    expect(await markRead(ORG_A, USER_OWNER, [notification.id])).toBe(0);
    expect(await unreadCount(ORG_A, USER_OTHER)).toBe(1);
    expect(sent?.notified).toEqual([USER_OTHER]);
  });

  it('읽은 알림은 목록에 남고 read 플래그만 바뀐다', async () => {
    await mention();
    await markRead(ORG_A, USER_OTHER);

    const page = await listNotifications(ORG_A, USER_OTHER);
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0].read).toBe(true);
  });
});

describe('자체 리뷰 반영 (KAN-32)', () => {
  it('볼 수 없는 비공개 채널의 사람은 멘션해도 알림이 생기지 않는다', async () => {
    // 조회는 visibleWhere를 통과하므로 유출은 아니지만, 알림 행 하나가 그 사람에게
    // 공짜 왕복(실시간 핑 → 재조회)을 강제하고, 나중에 그 채널에 초대되면 과거 알림이
    // 뒤늦게 튀어나온다.
    const secret = await prisma.channel.create({
      data: { orgId: ORG_A, name: '비밀', isPrivate: true, members: { create: { userId: USER_OWNER } } },
    });
    const body = '@김 주니 여기 좀';
    const sent = await createMessage(ORG_A, USER_OWNER, secret.id, body, undefined, [
      span(body, '김 주니', USER_OTHER),
    ]);

    expect(sent?.notified).toEqual([]);
    expect(await prisma.notification.count()).toBe(0);
    // 멘션 강조 자체는 남는다 — 본문에 그렇게 적혀 있으니 사실이다.
    expect(sent?.message.mentions).toHaveLength(1);
  });

  it('공개 채널에서는 미참여 조직 멤버도 멘션으로 부를 수 있다', async () => {
    const body = '@김 주니 이리 와요';
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, body, undefined, [
      span(body, '김 주니', USER_OTHER),
    ]);

    expect(sent?.notified).toEqual([USER_OTHER]);
  });

  it('channel 멘션에 실린 userId는 저장되지 않는다', async () => {
    const body = '@channel 공지';
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, body, undefined, [
      { ...span(body, 'channel', null, 'channel'), userId: 'user_지어낸_id' },
    ]);

    expect(sent?.message.mentions).toEqual([
      { kind: 'channel', userId: null, start: 0, length: 8 },
    ]);
    expect(await prisma.messageMention.findMany({ select: { userId: true } })).toEqual([
      { userId: null },
    ]);
  });

  it('같은 자리를 가리키는 스팬이 여럿이면 응답도 한 건으로 정규화된다', async () => {
    // 서버가 정규화하지 않으면 DB에는 복합 기본키로 1행만 남는데 응답과 브로드캐스트에는
    // 보낸 만큼 실려 나가, 보낸 사람 화면과 새로고침 후 화면이 달라진다.
    const body = '@김 주니 안녕';
    const one = span(body, '김 주니', USER_OTHER);
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, body, undefined, [one, one, one]);

    expect(sent?.message.mentions).toHaveLength(1);
    expect(await prisma.messageMention.count()).toBe(1);
  });
});
