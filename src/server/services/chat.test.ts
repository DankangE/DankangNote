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
import { MESSAGE_PAGE_SIZE, createMessage, listMessages, listThread } from './chat';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
  await seedChannels();
});

/**
 * 페이지네이션 테스트용 대량 시드. createdAt을 1초씩 벌려 넣어 '오래된 것부터' 순서가
 * 관측 가능하게 한다(같은 ms에 몰아 넣으면 id 타이브레이커만 검증하게 된다).
 */
async function seedMessages(channelId: string, count: number): Promise<void> {
  const base = new Date('2026-01-01T00:00:00.000Z').getTime();
  await prisma.chatMessage.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      id: `msg_${String(index).padStart(3, '0')}`,
      orgId: ORG_A,
      channelId,
      authorId: USER_OWNER,
      body: `메시지 ${index}`,
      createdAt: new Date(base + index * 1000),
    })),
  });
}

describe('멀티테넌시 격리', () => {
  it('listMessages는 자기 org·자기 채널의 메시지만 반환한다', async () => {
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, 'A의 메시지');
    await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B의 메시지');

    expect((await listMessages(ORG_A, USER_OWNER, CHANNEL_A)).messages.map((m) => m.body)).toEqual([
      'A의 메시지',
    ]);
    expect((await listMessages(ORG_B, USER_OTHER, CHANNEL_B)).messages.map((m) => m.body)).toEqual([
      'B의 메시지',
    ]);
  });

  it('남의 워크스페이스 채널 id를 알아도 읽지도 쓰지도 못한다', async () => {
    await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B의 비밀');

    // 내 org로 스코프한 채 남의 채널 id를 넘기는 경로 — 조회는 비고, 전송은 거부된다.
    expect((await listMessages(ORG_A, USER_OWNER, CHANNEL_B)).messages).toEqual([]);
    expect(await createMessage(ORG_A, USER_OWNER, CHANNEL_B, '끼어들기')).toBeNull();
    expect(await prisma.chatMessage.count({ where: { channelId: CHANNEL_B } })).toBe(1);
  });

  it('채널이 다르면 메시지가 섞이지 않는다', async () => {
    const other = await prisma.channel.create({ data: { orgId: ORG_A, name: '공지' } });
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '일반의 말');
    await createMessage(ORG_A, USER_OWNER, other.id, '공지의 말');

    expect((await listMessages(ORG_A, USER_OWNER, CHANNEL_A)).messages.map((m) => m.body)).toEqual([
      '일반의 말',
    ]);
    expect((await listMessages(ORG_A, USER_OWNER, other.id)).messages.map((m) => m.body)).toEqual([
      '공지의 말',
    ]);
  });

  it('오래된 것부터 시간순으로 반환한다', async () => {
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '첫 번째');
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '두 번째');
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '세 번째');

    expect((await listMessages(ORG_A, USER_OWNER, CHANNEL_A)).messages.map((m) => m.body)).toEqual([
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
    expect((await listMessages(ORG_A, USER_OTHER, secret.id)).messages).toEqual([]);
    expect(await createMessage(ORG_A, USER_OTHER, secret.id, '엿듣기')).toBeNull();
    // 참여자에게는 그대로 보인다.
    expect((await listMessages(ORG_A, USER_OWNER, secret.id)).messages.map((m) => m.body)).toEqual([
      '멤버끼리 하는 말',
    ]);
  });

  it('공개 채널에 처음 말하면 자동으로 참여된다 (슬랙식)', async () => {
    const open = await prisma.channel.create({ data: { orgId: ORG_A, name: '잡담' } });
    expect(await prisma.channelMember.count({ where: { channelId: open.id } })).toBe(0);

    const first = await createMessage(ORG_A, USER_OTHER, open.id, '안녕하세요');

    expect(
      await prisma.channelMember.count({ where: { channelId: open.id, userId: USER_OTHER } }),
    ).toBe(1);
    // joined는 액션이 채널 목록을 재검증할지 정하는 신호다 — 처음에만 true여야 한다.
    expect(first?.joined).toBe(true);
    expect((await createMessage(ORG_A, USER_OTHER, open.id, '또 왔어요'))?.joined).toBe(false);
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

    const [named, unnamed] = (await listMessages(ORG_A, USER_OWNER, CHANNEL_A)).messages;
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
    expect((await listMessages(ORG_A, USER_OWNER, CHANNEL_A)).messages.map((m) => m.body)).toEqual([
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
    const sent = await createMessage(ORG_A, 'user_brand_new', CHANNEL_A, '부트스트랩');

    expect(sent?.message.body).toBe('부트스트랩');
    expect(await prisma.user.count({ where: { id: 'user_brand_new' } })).toBe(1);
    expect(
      await prisma.channelMember.count({ where: { channelId: CHANNEL_A, userId: 'user_brand_new' } }),
    ).toBe(1);
  });
});

describe('커서 페이지네이션 (KAN-29)', () => {
  const TOTAL = MESSAGE_PAGE_SIZE + 3;

  it('첫 페이지는 가장 최신 한 페이지를 오래된 것부터 준다', async () => {
    await seedMessages(CHANNEL_A, TOTAL);

    const page = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);

    expect(page.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
    // 가장 오래된 3건은 잘려 나가고, 페이지 안은 시간 오름차순이다.
    expect(page.messages[0].body).toBe('메시지 3');
    expect(page.messages.at(-1)?.body).toBe(`메시지 ${TOTAL - 1}`);
  });

  it('커서로 그 앞 페이지를 이어 받고, 다 받으면 hasMore가 꺼진다', async () => {
    await seedMessages(CHANNEL_A, TOTAL);
    const first = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);

    const older = await listMessages(ORG_A, USER_OWNER, CHANNEL_A, first.messages[0].id);

    expect(older.messages.map((m) => m.body)).toEqual(['메시지 0', '메시지 1', '메시지 2']);
    expect(older.hasMore).toBe(false);
  });

  it.each([
    [0, false],
    [1, false],
    [MESSAGE_PAGE_SIZE - 1, false],
    // 정확히 한 페이지면 '더 있음'이 아니다 — >= 로 잘못 쓰면 빈 페이지를 부르는 버튼이 뜬다.
    [MESSAGE_PAGE_SIZE, false],
    [MESSAGE_PAGE_SIZE + 1, true],
  ])('메시지 %i건일 때 hasMore는 %s다', async (count, expected) => {
    await seedMessages(CHANNEL_A, count);

    const page = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);

    expect(page.messages).toHaveLength(Math.min(count, MESSAGE_PAGE_SIZE));
    expect(page.hasMore).toBe(expected);
  });

  it('페이지끼리 겹치지도 빠지지도 않는다 (세 페이지 이상 순회)', async () => {
    // 커서로 받은 페이지에서 다시 커서를 뽑는 경로까지 지나가도록 세 페이지 분량을 쓴다.
    const total = MESSAGE_PAGE_SIZE * 2 + 7;
    await seedMessages(CHANNEL_A, total);

    const collected: string[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    // 상한을 둬 hasMore가 고장 나면 타임아웃 대신 이 단언에서 죽게 한다.
    for (let page = 0; hasMore && page < 10; page++) {
      const result: Awaited<ReturnType<typeof listMessages>> = await listMessages(
        ORG_A,
        USER_OWNER,
        CHANNEL_A,
        cursor,
      );
      collected.unshift(...result.messages.map((m) => m.body));
      cursor = result.messages[0]?.id;
      hasMore = result.hasMore;
    }

    expect(hasMore).toBe(false);
    expect(collected).toEqual(Array.from({ length: total }, (_, i) => `메시지 ${i}`));
    expect(new Set(collected).size).toBe(total);
  });

  it('createdAt이 같아도 커서가 자기 자신이나 이웃을 다시 집지 않는다', async () => {
    // 같은 ms에 몰린 연속 전송 — 키셋의 id 타이브레이커가 없으면 무한 루프가 된다.
    const sameMoment = new Date('2026-01-01T00:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: ['a', 'b', 'c'].map((id) => ({
        id,
        orgId: ORG_A,
        channelId: CHANNEL_A,
        authorId: USER_OWNER,
        body: id,
        createdAt: sameMoment,
      })),
    });

    const first = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);
    expect(first.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);

    const older = await listMessages(ORG_A, USER_OWNER, CHANNEL_A, 'b');
    expect(older.messages.map((m) => m.id)).toEqual(['a']);
  });

  it('남의 채널 메시지를 커서로 넣어도 그 채널을 읽지 못한다', async () => {
    await seedMessages(CHANNEL_A, 5);
    const foreign = await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B의 비밀');

    // 커서가 이 채널 것이 아니면 앵커를 못 찾아 빈 페이지다 — 남의 메시지가 새지 않는다.
    const page = await listMessages(ORG_A, USER_OWNER, CHANNEL_A, foreign!.message.id);

    expect(page).toEqual({ messages: [], hasMore: false });
  });

  // 이 케이스는 본 쿼리의 채널 가시성만으로도 막힌다(앵커 스코프를 지워도 통과한다).
  // 앵커 조회의 스코프를 고정하는 건 위의 '남의 채널 메시지를 커서로' 케이스다.
  it('참여하지 않은 비공개 채널은 커서를 줘도 빈 페이지다', async () => {
    const secret = await prisma.channel.create({
      data: {
        orgId: ORG_A,
        name: '비밀',
        isPrivate: true,
        members: { create: { userId: USER_OWNER } },
      },
    });
    await seedMessages(secret.id, 5);
    const mine = await listMessages(ORG_A, USER_OWNER, secret.id);

    const stolen = await listMessages(ORG_A, USER_OTHER, secret.id, mine.messages[0].id);

    expect(stolen).toEqual({ messages: [], hasMore: false });
  });

  it('없는 커서를 주면 조용히 빈 페이지를 준다', async () => {
    await seedMessages(CHANNEL_A, 5);

    expect(await listMessages(ORG_A, USER_OWNER, CHANNEL_A, 'msg_does_not_exist')).toEqual({
      messages: [],
      hasMore: false,
    });
  });
});

describe('스레드 (KAN-30)', () => {
  it('답글은 채널 본문에 섞이지 않고 답글 수로만 드러난다', async () => {
    const root = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    await createMessage(ORG_A, USER_OTHER, CHANNEL_A, '답글 1', root!.message.id);
    await createMessage(ORG_A, USER_OTHER, CHANNEL_A, '답글 2', root!.message.id);

    const page = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);

    expect(page.messages.map((m) => m.body)).toEqual(['루트']);
    expect(page.messages[0].replyCount).toBe(2);
  });

  it('스레드는 루트와 답글을 오래된 것부터 준다', async () => {
    const root = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    await createMessage(ORG_A, USER_OTHER, CHANNEL_A, '첫 답글', root!.message.id);
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '둘째 답글', root!.message.id);
    // 같은 채널의 다른 대화는 섞이면 안 된다.
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '상관없는 메시지');

    const thread = await listThread(ORG_A, USER_OWNER, root!.message.id);

    expect(thread?.root.body).toBe('루트');
    expect(thread?.root.replyCount).toBe(2);
    expect(thread?.page.messages.map((m) => m.body)).toEqual(['첫 답글', '둘째 답글']);
  });

  it('답글에는 답글을 달 수 없다 (스레드는 1단계)', async () => {
    const root = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const reply = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '답글', root!.message.id);

    expect(await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '답글의 답글', reply!.message.id)).toBeNull();
    // 답글 id로는 스레드도 열리지 않는다.
    expect(await listThread(ORG_A, USER_OWNER, reply!.message.id)).toBeNull();
  });

  it('다른 채널의 메시지에는 답글을 달 수 없다', async () => {
    const other = await prisma.channel.create({ data: { orgId: ORG_A, name: '공지' } });
    const root = await createMessage(ORG_A, USER_OWNER, other.id, '공지의 루트');

    // 볼 수 있는 채널이어도 부모는 같은 채널이어야 한다 — 아니면 어느 채널에도 안 보이는
    // 고아 답글이 생긴다.
    expect(
      await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '엉뚱한 답글', root!.message.id),
    ).toBeNull();
  });

  it('남의 워크스페이스 메시지에는 답글을 달 수도, 스레드를 열 수도 없다', async () => {
    const foreign = await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B의 루트');

    expect(await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '끼어들기', foreign!.message.id)).toBeNull();
    expect(await listThread(ORG_A, USER_OWNER, foreign!.message.id)).toBeNull();
  });

  it('참여하지 않은 비공개 채널의 스레드는 열리지 않는다', async () => {
    const secret = await prisma.channel.create({
      data: {
        orgId: ORG_A,
        name: '비밀',
        isPrivate: true,
        members: { create: { userId: USER_OWNER } },
      },
    });
    const root = await createMessage(ORG_A, USER_OWNER, secret.id, '비밀 루트');
    await createMessage(ORG_A, USER_OWNER, secret.id, '비밀 답글', root!.message.id);

    expect(await listThread(ORG_A, USER_OTHER, root!.message.id)).toBeNull();
    expect((await listThread(ORG_A, USER_OWNER, root!.message.id))?.page.messages).toHaveLength(1);
  });

  it('루트를 지우면 그 답글도 함께 파기된다', async () => {
    const root = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    await createMessage(ORG_A, USER_OTHER, CHANNEL_A, '답글', root!.message.id);
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '남을 메시지');

    await prisma.chatMessage.delete({ where: { id: root!.message.id } });

    expect(await prisma.chatMessage.count({ where: { channelId: CHANNEL_A } })).toBe(1);
  });

  it('답글도 키셋 커서로 페이지를 넘긴다', async () => {
    const root = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const base = new Date('2026-02-01T00:00:00.000Z').getTime();
    await prisma.chatMessage.createMany({
      data: Array.from({ length: MESSAGE_PAGE_SIZE + 2 }, (_, index) => ({
        id: `reply_${String(index).padStart(3, '0')}`,
        orgId: ORG_A,
        channelId: CHANNEL_A,
        parentId: root!.message.id,
        authorId: USER_OWNER,
        body: `답글 ${index}`,
        createdAt: new Date(base + index * 1000),
      })),
    });

    const first = await listThread(ORG_A, USER_OWNER, root!.message.id);
    expect(first?.page.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(first?.page.hasMore).toBe(true);

    const older = await listThread(ORG_A, USER_OWNER, root!.message.id, first!.page.messages[0].id);
    expect(older?.page.messages.map((m) => m.body)).toEqual(['답글 0', '답글 1']);
    expect(older?.page.hasMore).toBe(false);
  });
});
