import { setTimeout } from 'node:timers/promises';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import type { Prisma } from '@/server/generated/prisma/client';
import {
  CHANNEL_A,
  CHANNEL_B,
  ORG_A,
  ORG_B,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedChannels,
  seedMessages as seedMessageRows,
  seedTenants,
} from '../../../test/db';
import {
  MESSAGE_PAGE_SIZE,
  createMessage,
  listMessages,
  listThread,
  toggleReaction,
} from './chat';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
  await seedChannels();
});

/** 메시지 순번은 뷰에 싣지 않는다(클라이언트가 쓸 일이 없다) — DB에서 직접 읽는다. */
async function seqOfMessage(id: string): Promise<number> {
  return (await prisma.chatMessage.findUniqueOrThrow({ where: { id }, select: { seq: true } })).seq;
}

/** 서비스를 거치지 않고 이물 행 한 건을 심고 그 행을 돌려준다. */
async function plant(row: Parameters<typeof seedMessageRows>[0][number]) {
  const [created] = await seedMessageRows([row]);
  return created;
}

/**
 * 페이지네이션 테스트용 대량 시드. createdAt은 1초씩 벌려 두지만 순서의 근거는 아니다 —
 * 정렬은 심은 순서대로 붙는 seq를 따른다(KAN-55).
 */
async function seedMessages(channelId: string, count: number): Promise<void> {
  const base = new Date('2026-01-01T00:00:00.000Z').getTime();
  await seedMessageRows(
    Array.from({ length: count }, (_, index) => ({
      id: `msg_${String(index).padStart(3, '0')}`,
      orgId: ORG_A,
      channelId,
      authorId: USER_OWNER,
      body: `메시지 ${index}`,
      createdAt: new Date(base + index * 1000),
    })),
  );
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

  it('createdAt이 전부 같아도 순서와 커서가 흔들리지 않는다 (KAN-55)', async () => {
    // 시각을 한 점에 몰아 넣어 '정렬이 시각과 무관하다'를 눈에 보이게 한다. 시각이 근거였을
    // 때는 여기서 동률을 가를 id 타이브레이커가 필요했고, 그게 없으면 커서가 자기 자신을
    // 다시 집어 무한 루프가 됐다. 이제 근거는 채널 순번이라 동률 자체가 생기지 않는다.
    const sameMoment = new Date('2026-01-01T00:00:00.000Z');
    await seedMessageRows(
      ['a', 'b', 'c'].map((id) => ({
        id,
        orgId: ORG_A,
        channelId: CHANNEL_A,
        authorId: USER_OWNER,
        body: id,
        createdAt: sameMoment,
      })),
    );

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
    await seedMessageRows(
      Array.from({ length: MESSAGE_PAGE_SIZE + 2 }, (_, index) => ({
        id: `reply_${String(index).padStart(3, '0')}`,
        orgId: ORG_A,
        channelId: CHANNEL_A,
        parentId: root!.message.id,
        authorId: USER_OWNER,
        body: `답글 ${index}`,
        createdAt: new Date(base + index * 1000),
      })),
    );

    const first = await listThread(ORG_A, USER_OWNER, root!.message.id);
    expect(first?.page.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(first?.page.hasMore).toBe(true);

    const older = await listThread(ORG_A, USER_OWNER, root!.message.id, first!.page.messages[0].id);
    expect(older?.page.messages.map((m) => m.body)).toEqual(['답글 0', '답글 1']);
    expect(older?.page.hasMore).toBe(false);
  });
});

describe('스레드 격리 — 쿼리 조건 고정 (KAN-30 리뷰)', () => {
  // 아래 두 케이스는 orgId와 channelId가 어긋난 행을 직접 심는다. 서비스만 거치면 그런
  // 행은 안 생기지만 DB에는 둘을 묶는 제약이 없고(복합 FK도 CHECK도 없다), 그래서 조회
  // 조건에서 orgId를 빼도 채널 조건만으로 통과해 버리는지 아닌지가 드러나지 않는다.

  it('내가 볼 수 있는 채널에 놓였어도 남의 org 메시지에는 답글을 달 수 없다', async () => {
    const planted = await plant({
      orgId: ORG_B,
      channelId: CHANNEL_A,
      authorId: USER_OTHER,
      body: 'B 소속 루트',
    });

    expect(
      await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '남의 루트에 답글', planted.id),
    ).toBeNull();
  });

  it('내가 볼 수 있는 채널에 놓였어도 남의 org 메시지는 스레드로 열리지 않는다', async () => {
    const planted = await plant({
      orgId: ORG_B,
      channelId: CHANNEL_A,
      authorId: USER_OTHER,
      body: 'B 소속 루트',
    });

    expect(await listThread(ORG_A, USER_OWNER, planted.id)).toBeNull();
  });

  it('부모만 가리킬 뿐 다른 워크스페이스에 속한 답글 행은 스레드에 안 나온다', async () => {
    // 답글의 channelId·orgId가 부모와 같다는 불변식은 DB로 표현돼 있지 않다. 서비스를
    // 거치지 않고 이물 행을 심어, 조회가 스스로 테넌트 스코프를 갖는지 확인한다.
    const root = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    await seedMessageRows([
      {
        orgId: ORG_B,
        channelId: CHANNEL_B,
        parentId: root!.message.id,
        authorId: USER_OTHER,
        body: 'B에 속한 이물 답글',
      },
    ]);

    const thread = await listThread(ORG_A, USER_OWNER, root!.message.id);

    expect(thread?.page.messages).toEqual([]);
    expect(thread?.root.replyCount).toBe(1);
  });

  it('답글도 createdAt이 전부 같을 때 순서와 커서가 흔들리지 않는다 (KAN-55)', async () => {
    const root = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const sameMoment = new Date('2026-03-01T00:00:00.000Z');
    await seedMessageRows(
      ['ra', 'rb', 'rc'].map((id) => ({
        id,
        orgId: ORG_A,
        channelId: CHANNEL_A,
        parentId: root!.message.id,
        authorId: USER_OWNER,
        body: id,
        createdAt: sameMoment,
      })),
    );

    const first = await listThread(ORG_A, USER_OWNER, root!.message.id);
    expect(first?.page.messages.map((m) => m.id)).toEqual(['ra', 'rb', 'rc']);

    const older = await listThread(ORG_A, USER_OWNER, root!.message.id, 'rb');
    expect(older?.page.messages.map((m) => m.id)).toEqual(['ra']);
  });

  it('본문의 답글 수와 스레드가 돌려주는 답글이 일치한다', async () => {
    const root = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    await createMessage(ORG_A, USER_OTHER, CHANNEL_A, '답글 1', root!.message.id);
    await createMessage(ORG_A, USER_OTHER, CHANNEL_A, '답글 2', root!.message.id);
    // 다른 루트의 답글이 섞여 세어지면 안 된다.
    const other = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '다른 루트');
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '남의 답글', other!.message.id);

    const page = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);
    const thread = await listThread(ORG_A, USER_OWNER, root!.message.id);

    const rootRow = page.messages.find((m) => m.id === root!.message.id);
    expect(rootRow?.replyCount).toBe(2);
    expect(thread?.page.messages).toHaveLength(2);
    expect(page.messages.find((m) => m.id === other!.message.id)?.replyCount).toBe(1);
  });
});

describe('이모지 리액션 (KAN-31)', () => {
  it('같은 이모지를 다시 누르면 취소된다 (토글)', async () => {
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const id = sent!.message.id;

    const added = await toggleReaction(ORG_A, USER_OWNER, id, '👍');
    expect(added).toMatchObject({ added: true, count: 1, emoji: '👍', channelId: CHANNEL_A });

    const removed = await toggleReaction(ORG_A, USER_OWNER, id, '👍');
    expect(removed).toMatchObject({ added: false, count: 0 });
    expect(await prisma.messageReaction.count()).toBe(0);
  });

  it('여러 사람이 같은 이모지를 눌러도 각자 한 번씩만 센다', async () => {
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const id = sent!.message.id;

    await toggleReaction(ORG_A, USER_OWNER, id, '👍');
    const second = await toggleReaction(ORG_A, USER_OTHER, id, '👍');
    expect(second?.count).toBe(2);

    // 한 사람이 취소해도 남의 몫은 남는다.
    const back = await toggleReaction(ORG_A, USER_OWNER, id, '👍');
    expect(back).toMatchObject({ added: false, count: 1 });
  });

  it('조회는 이모지별로 접고 mine을 보는 사람 기준으로 채운다', async () => {
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const id = sent!.message.id;
    await toggleReaction(ORG_A, USER_OWNER, id, '👍');
    await toggleReaction(ORG_A, USER_OTHER, id, '👍');
    await toggleReaction(ORG_A, USER_OTHER, id, '🎉');

    const asOwner = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);
    expect(asOwner.messages[0].reactions).toEqual([
      { emoji: '👍', count: 2, mine: true },
      { emoji: '🎉', count: 1, mine: false },
    ]);

    const asOther = await listMessages(ORG_A, USER_OTHER, CHANNEL_A);
    expect(asOther.messages[0].reactions).toEqual([
      { emoji: '👍', count: 2, mine: true },
      { emoji: '🎉', count: 1, mine: true },
    ]);
  });

  it('칩 순서는 누른 순서가 아니라 팔레트 순서로 고정된다', async () => {
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const id = sent!.message.id;
    // 팔레트 역순으로 누른다 — 삽입 순서를 그대로 쓰면 이 순서가 그대로 나온다.
    await toggleReaction(ORG_A, USER_OWNER, id, '🔥');
    await toggleReaction(ORG_A, USER_OWNER, id, '❤️');
    await toggleReaction(ORG_A, USER_OWNER, id, '👍');

    const page = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);
    expect(page.messages[0].reactions.map((r) => r.emoji)).toEqual(['👍', '❤️', '🔥']);
  });

  it('답글에도 리액션을 달 수 있고 스레드 조회에 실린다', async () => {
    const root = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const reply = await createMessage(ORG_A, USER_OTHER, CHANNEL_A, '답글', root!.message.id);

    const delta = await toggleReaction(ORG_A, USER_OWNER, reply!.message.id, '✅');
    // 답글의 델타는 parentId를 싣는다 — 수신 측이 본문이 아니라 스레드 패널에 반영해야 한다.
    expect(delta).toMatchObject({ parentId: root!.message.id, count: 1 });

    const thread = await listThread(ORG_A, USER_OWNER, root!.message.id);
    expect(thread?.page.messages[0].reactions).toEqual([{ emoji: '✅', count: 1, mine: true }]);
    // 답글에 달린 리액션이 루트로 새지 않는다.
    expect(thread?.root.reactions).toEqual([]);
  });

  it('리액션은 자기 메시지에만 붙는다 (다른 메시지로 새지 않는다)', async () => {
    const first = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '첫 번째');
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '두 번째');
    await toggleReaction(ORG_A, USER_OWNER, first!.message.id, '👀');

    const page = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);
    expect(page.messages.map((m) => m.reactions.length)).toEqual([1, 0]);
  });
});

describe('리액션 격리 · 수명 (KAN-31)', () => {
  it('남의 워크스페이스 메시지에는 리액션할 수 없다', async () => {
    const foreign = await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B의 메시지');

    expect(await toggleReaction(ORG_A, USER_OWNER, foreign!.message.id, '👍')).toBeNull();
    expect(await prisma.messageReaction.count()).toBe(0);
  });

  it('내가 볼 수 있는 채널에 놓였어도 남의 org 메시지에는 리액션할 수 없다', async () => {
    // 스레드와 같은 이유의 이물 행 — orgId와 channelId를 묶는 DB 제약이 없어서, 조회 조건에서
    // orgId를 빼도 채널 조건만으로 통과해 버리는지가 이 케이스에서만 드러난다.
    const planted = await plant({
      orgId: ORG_B,
      channelId: CHANNEL_A,
      authorId: USER_OTHER,
      body: 'B 소속',
    });

    expect(await toggleReaction(ORG_A, USER_OWNER, planted.id, '👍')).toBeNull();
  });

  it('참여하지 않은 비공개 채널의 메시지에는 리액션할 수 없다', async () => {
    const secret = await prisma.channel.create({
      data: {
        orgId: ORG_A,
        name: '비밀',
        isPrivate: true,
        members: { create: { userId: USER_OWNER } },
      },
    });
    const message = await createMessage(ORG_A, USER_OWNER, secret.id, '비밀');

    expect(await toggleReaction(ORG_A, USER_OTHER, message!.message.id, '👍')).toBeNull();
    expect(await toggleReaction(ORG_A, USER_OWNER, message!.message.id, '👍')).toMatchObject({
      added: true,
    });
  });

  it('남의 리액션은 내가 취소할 수 없다', async () => {
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    await toggleReaction(ORG_A, USER_OTHER, sent!.message.id, '👍');

    // 같은 이모지를 누르면 '취소'가 아니라 '나도 추가'다 — 토글의 대상은 내 행뿐이다.
    const mine = await toggleReaction(ORG_A, USER_OWNER, sent!.message.id, '👍');
    expect(mine).toMatchObject({ added: true, count: 2 });
  });

  it('메시지를 지우면 그 리액션도 함께 파기된다', async () => {
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    await toggleReaction(ORG_A, USER_OWNER, sent!.message.id, '👍');

    await prisma.chatMessage.delete({ where: { id: sent!.message.id } });

    expect(await prisma.messageReaction.count()).toBe(0);
  });

  it('조직을 지우면 그 조직의 리액션도 함께 파기된다', async () => {
    const mine = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, 'A의 메시지');
    const theirs = await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B의 메시지');
    await toggleReaction(ORG_A, USER_OWNER, mine!.message.id, '👍');
    await toggleReaction(ORG_B, USER_OTHER, theirs!.message.id, '👍');

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.messageReaction.findMany()).toMatchObject([{ orgId: ORG_B }]);
  });

  it('삭제된 org·사용자로는 리액션할 수 없다', async () => {
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    await prisma.clerkTombstone.create({ data: { id: USER_OWNER } });

    await expect(toggleReaction(ORG_A, USER_OWNER, sent!.message.id, '👍')).rejects.toThrow();
    // 가드가 pre-check에서 멈추므로 행이 남지 않는다.
    expect(await prisma.messageReaction.count()).toBe(0);
  });
});

describe('리액션 자체 리뷰 반영 (KAN-31)', () => {
  it('토글이 돌려주는 count는 자기 쓰기를 반드시 반영한다', async () => {
    // 토글과 집계가 한 트랜잭션이 아니면, 내 요청이 내 변경조차 안 담긴 값을 돌려줄 수 있다.
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const id = sent!.message.id;

    const add = await toggleReaction(ORG_A, USER_OWNER, id, '👍');
    expect(add!.count).toBe(await prisma.messageReaction.count({ where: { messageId: id } }));

    const remove = await toggleReaction(ORG_A, USER_OWNER, id, '👍');
    expect(remove!.count).toBe(0);
  });

  it('조회의 리액션 집계도 org로 스코프된다', async () => {
    // orgId와 messageId가 어긋난 행은 서비스만 거치면 안 생긴다. 조회 조건에서 orgId를
    // 빼도 messageId만으로 통과해 버리는지는 이물 행을 심어야만 드러난다(스레드와 같은 이유).
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    await toggleReaction(ORG_A, USER_OWNER, sent!.message.id, '👍');
    await prisma.messageReaction.create({
      data: { messageId: sent!.message.id, userId: USER_OTHER, emoji: '🎉', orgId: ORG_B },
    });

    const page = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);

    expect(page.messages[0].reactions).toEqual([{ emoji: '👍', count: 1, mine: true }]);
  });

  it('조직을 지워도 남의 org 리액션은 그 메시지에 남지 않는다', async () => {
    // 위 이물 행이 org 삭제 cascade를 타는지 — orgId FK가 실제로 걸려 있는지 확인한다.
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    await prisma.messageReaction.create({
      data: { messageId: sent!.message.id, userId: USER_OTHER, emoji: '🎉', orgId: ORG_B },
    });

    await prisma.organization.delete({ where: { id: ORG_B } });

    expect(await prisma.messageReaction.count()).toBe(0);
  });
});

describe('메시지 순번 = 커밋 순서 (KAN-55)', () => {
  /** 메시지 순번은 뷰에 싣지 않는다(클라이언트가 쓸 일이 없다) — DB에서 직접 읽는다. */
  const seqOf = async (id: string) =>
    (await prisma.chatMessage.findUniqueOrThrow({ where: { id }, select: { seq: true } })).seq;

  /** 채널 카운터를 잠그고 다음 번호를 받는다 — 전송 트랜잭션의 첫 문장과 같은 SQL이다. */
  const takeSeq = (tx: Prisma.TransactionClient, channelId: string) =>
    tx.$queryRaw<{ messageSeq: number }[]>`
      UPDATE "Channel" SET "messageSeq" = "messageSeq" + 1
      WHERE "id" = ${channelId}
      RETURNING "messageSeq"
    `;

  it('번호를 받고 커밋이 늦어져도 뒤 전송이 앞지르지 못한다', async () => {
    // 이 티켓의 뿌리다. 번호(옛날엔 시각)를 받는 시점과 커밋 시점이 벌어지면, 늦게 커밋된
    // 작은 번호가 이미 전진한 읽음 커서 아래에 깔려 영영 안읽음에서 빠진다.
    //
    // 그래서 '앞 전송이 번호를 받은 뒤 커밋 전에 늦어지는' 상황을 실제로 만든다. 미러 행을
    // 쥐고 커밋을 미루는 트랜잭션을 세워 두면, 그 사용자로 들어온 전송은 카운터를 지나
    // userSkeleton에서 멈춘다 — 채널 카운터 잠금을 쥔 채로. 그 잠금이 커밋까지 유지되는지가
    // 여기서 드러난다(카운터를 트랜잭션 밖에서 올리면 뒤 전송이 그대로 앞질러 커밋한다).
    const latecomer = 'user_slow_mirror';
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.user.createMany({ data: [{ id: latecomer }], skipDuplicates: true });
        await held;
      },
      { timeout: 20_000 },
    );

    const slow = createMessage(ORG_A, latecomer, CHANNEL_A, '먼저 번호를 받은 말');
    // 번호를 받고 미러 행에서 멈출 때까지 준다.
    await setTimeout(300);

    const racer = createMessage(ORG_A, USER_OWNER, CHANNEL_A, '뒤에 들어온 말');
    const outcome = await Promise.race([
      racer.then(() => 'passed' as const),
      setTimeout(400, 'blocked' as const),
    ]);
    expect(outcome).toBe('blocked');

    release();
    await blocker;
    const [first, second] = await Promise.all([slow, racer]);

    // 번호가 작은 쪽이 먼저 커밋한 쪽이다 — 순번을 신뢰할 수 있다는 말의 전부다.
    expect(await seqOf(first!.message.id)).toBeLessThan(await seqOf(second!.message.id));
  });

  it('롤백된 전송은 번호를 소모하지 않는다 — 순번에 구멍이 없다', async () => {
    // 구멍이 없다는 것이 커서 계산의 전제다. BIGSERIAL이었다면 여기서 번호가 하나 날아간다.
    await expect(
      prisma.$transaction(async (tx) => {
        await takeSeq(tx, CHANNEL_A);
        throw new Error('의도적 롤백');
      }),
    ).rejects.toThrow('의도적 롤백');

    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '롤백 다음 말');

    expect(await seqOf(sent!.message.id)).toBe(1);
  });

  it('채널마다 따로 센다 — 남의 채널 전송이 내 번호를 밀지 않는다', async () => {
    await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B의 말 1');
    await createMessage(ORG_B, USER_OTHER, CHANNEL_B, 'B의 말 2');
    const mine = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, 'A의 첫 말');

    expect(await seqOf(mine!.message.id)).toBe(1);
  });

  it('같은 채널의 답글도 같은 카운터에서 번호를 받는다', async () => {
    const root = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const reply = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '답글', root!.message.id);
    const next = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '그다음 본문');

    // 한 채널 안에서 (channelId, seq)가 unique이므로 본문과 답글이 번호를 나눠 쓸 수 없다.
    expect([
      await seqOf(root!.message.id),
      await seqOf(reply!.message.id),
      await seqOf(next!.message.id),
    ]).toEqual([1, 2, 3]);
  });
});

describe('리액션 집계 버전 (KAN-52)', () => {
  const versionOf = async (id: string) =>
    (await prisma.chatMessage.findUniqueOrThrow({ where: { id }, select: { reactionSeq: true } }))
      .reactionSeq;

  it('토글마다 버전이 오르고 델타에 실려 나간다', async () => {
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const id = sent!.message.id;
    // 조회 스냅샷의 기준선 — 아직 아무도 안 눌렀으니 0이다.
    expect(sent!.message.reactionVersion).toBe(0);

    const first = await toggleReaction(ORG_A, USER_OWNER, id, '👍');
    const second = await toggleReaction(ORG_A, USER_OTHER, id, '👍');
    const other = await toggleReaction(ORG_A, USER_OWNER, id, '🎉');

    // 이모지가 달라도 한 메시지의 카운터를 함께 쓴다 — 수신 측이 이모지별로 비교하므로
    // 번호가 섞여도 되고, 카운터를 이모지마다 두면 행만 늘어난다.
    expect([first!.version, second!.version, other!.version]).toEqual([1, 2, 3]);
    expect(await versionOf(id)).toBe(3);
  });

  it('메시지마다 따로 센다 — 옆 말풍선의 리액션이 내 번호를 밀지 않는다', async () => {
    const a = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '가');
    const b = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '나');
    await toggleReaction(ORG_A, USER_OWNER, a!.message.id, '👍');
    await toggleReaction(ORG_A, USER_OTHER, a!.message.id, '👍');

    expect((await toggleReaction(ORG_A, USER_OWNER, b!.message.id, '👍'))!.version).toBe(1);
  });

  it('번호를 받고 커밋이 늦어져도 뒤 토글이 앞지르지 못한다', async () => {
    // 번호와 count가 같은 트랜잭션에서 나오는 것만으로는 부족하다 — 잠금이 **커밋까지**
    // 유지돼야 '번호 순서 = 커밋 순서'가 성립하고, 그래야 수신 측의 낮은 번호 버리기가
    // 옳은 판정이 된다.
    //
    // 그래서 토글이 번호를 받은 뒤 커밋 전에 늦어지는 상황을 만든다: 그 사람의 리액션 행을
    // FOR UPDATE로 쥐고 있으면, 그 행을 지우러 온 토글이 카운터를 지난 자리에서 멈춘다.
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    const id = sent!.message.id;
    await prisma.messageReaction.create({
      data: { messageId: id, userId: USER_OWNER, emoji: '👍', orgId: ORG_A },
    });

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "messageId" FROM "MessageReaction"
          WHERE "messageId" = ${id} AND "userId" = ${USER_OWNER} AND "emoji" = '👍'
          FOR UPDATE
        `;
        await held;
      },
      { timeout: 20_000 },
    );

    const slow = toggleReaction(ORG_A, USER_OWNER, id, '👍');
    // 번호를 받고 리액션 행에서 멈출 때까지 준다.
    await setTimeout(300);

    const racer = toggleReaction(ORG_A, USER_OTHER, id, '🎉');
    const outcome = await Promise.race([
      racer.then(() => 'passed' as const),
      setTimeout(400, 'blocked' as const),
    ]);
    expect(outcome).toBe('blocked');

    release();
    await blocker;
    const [first, second] = await Promise.all([slow, racer]);

    expect(first!.version).toBeLessThan(second!.version);
  });

  it('리액션 버전은 메시지 순번과 별개다 — 서로를 밀지 않는다', async () => {
    // 채널 카운터를 같이 쓰면 리액션 몇 번이 전송의 번호를 밀고, 무엇보다 같은 행에서
    // 직렬화돼 리액션이 전송을 막는다.
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '루트');
    await toggleReaction(ORG_A, USER_OWNER, sent!.message.id, '👍');
    await toggleReaction(ORG_A, USER_OTHER, sent!.message.id, '🎉');

    const next = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '다음 말');

    expect(await seqOfMessage(next!.message.id)).toBe(2);
  });
});
