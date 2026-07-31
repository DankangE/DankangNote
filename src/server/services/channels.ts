import 'server-only';

import { prisma } from '@/server/db';
import { Prisma } from '@/server/generated/prisma/client';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { orgSkeleton, userSkeleton } from '@/server/services/skeleton';
import { unreadCounts } from '@/server/services/channel-reads';

/**
 * 워크스페이스의 기본 채널 이름. ensureDefaultChannel의 멱등 키이기도 하다 —
 * [orgId, name] 유니크에 기대어 동시 첫 접속에도 채널이 하나만 생긴다. 그래서 기본 채널은
 * 이름을 바꿀 수 없다(주제는 바꿀 수 있다). 마이그레이션의 백필도 같은 이름을 쓴다.
 */
export const DEFAULT_CHANNEL_NAME = '일반';
const DEFAULT_CHANNEL_TOPIC = '워크스페이스 멤버 전체 대화';

/** 채널 관리 요청자. isAdmin은 Clerk 세션 클레임 기반이다 — 미러 role은 안 쓴다(KAN-18). */
export interface ChannelActor {
  userId: string;
  isAdmin: boolean;
}

export interface ChannelView {
  id: string;
  name: string;
  topic: string | null;
  isPrivate: boolean;
  isDefault: boolean;
  /** 내가 참여 중인가 — 사이드바 '내 채널' 구성과 나가기 버튼 노출에 쓴다. */
  isMember: boolean;
  /** 이름·주제 수정과 삭제가 가능한가(생성자 본인 또는 org:admin). */
  canManage: boolean;
  memberCount: number;
  /** 안읽음 수 (KAN-33). 참여하지 않은 채널은 언제나 0이다. */
  unread: number;
}

export interface ChannelInput {
  name: string;
  topic: string | null;
  isPrivate: boolean;
}

export type ChannelOutcome =
  | { status: 'ok'; channel: ChannelView }
  | { status: 'duplicate' }
  | { status: 'forbidden' }
  | { status: 'notfound' }
  /** 기본 채널이라 거부됨 — 이름 변경·삭제가 막혀 있다. */
  | { status: 'default' };

/**
 * 접근 판정의 단일 지점 — 공개 채널은 조직 멤버 전체, 비공개 채널은 참여자만.
 * 목록·조회·전송·Pusher 채널 인증이 전부 이 where를 통과한다(쿼리 수준 격리, backend.md).
 * admin에게도 예외를 두지 않는다: 비공개 대화 열람은 역할 권한과 다른 문제이고, 예외를
 * 하나 만들면 '보이지 않지만 관리할 수는 있는' 채널이 생겨 규칙이 갈라진다.
 */
export function visibleWhere(orgId: string, userId: string): Prisma.ChannelWhereInput {
  return { orgId, OR: [{ isPrivate: false }, { members: { some: { userId } } }] };
}

const VIEW_INCLUDE = (userId: string) =>
  ({
    // 내 참여 행만 뽑아 isMember 판정에 쓴다(전체 멤버를 실어 오지 않는다).
    members: { where: { userId }, select: { userId: true } },
  }) satisfies Prisma.ChannelInclude;

type ChannelRow = Prisma.ChannelGetPayload<{
  include: { members: { select: { userId: true } } };
}>;

/**
 * 이 채널들의 참여자 수 (KAN-33 적대적 리뷰).
 *
 * 한때 `_count: { select: { members: true } }`였는데, 그건 KAN-30에서 걸러낸 것과 **정확히
 * 같은 함정**이다 — 필터 없는 전 테이블 GROUP BY로 컴파일돼 비용이 전체 테넌트 합계에
 * 비례한다. 남의 워크스페이스가 참여 행 20만 개를 쌓으면 내 채널 목록이 0.5ms에서 33ms로
 * 느려졌다(실측 65배, 답은 그대로). 이번 페이지의 채널 id로 스코프한 groupBy 한 번이면 된다.
 */
async function countMembers(channelIds: string[]): Promise<Map<string, number>> {
  if (channelIds.length === 0) {
    return new Map();
  }
  const grouped = await prisma.channelMember.groupBy({
    by: ['channelId'],
    where: { channelId: { in: channelIds } },
    _count: { _all: true },
  });
  return new Map(grouped.map((row) => [row.channelId, row._count._all]));
}

function toView(
  channel: ChannelRow,
  actor: ChannelActor,
  memberCount: number,
  unread = 0,
): ChannelView {
  return {
    id: channel.id,
    name: channel.name,
    topic: channel.topic,
    isPrivate: channel.isPrivate,
    isDefault: channel.isDefault,
    isMember: channel.members.length > 0,
    canManage: actor.isAdmin || channel.createdById === actor.userId,
    memberCount,
    unread,
  };
}

/**
 * 사이드바용 목록 — 기본 채널이 맨 위, 나머지는 이름순.
 * 안읽음 수를 함께 싣는다(KAN-33) — 사이드바가 목록과 뱃지를 따로 받으면 그 사이에
 * 채널이 생기거나 사라졌을 때 뱃지만 남거나 채널만 남는 화면이 나온다.
 */
export async function listChannels(orgId: string, actor: ChannelActor): Promise<ChannelView[]> {
  const [channels, unread] = await Promise.all([
    prisma.channel.findMany({
      where: visibleWhere(orgId, actor.userId),
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: VIEW_INCLUDE(actor.userId),
    }),
    unreadCounts(orgId, actor.userId),
  ]);
  const memberCounts = await countMembers(channels.map((channel) => channel.id));
  return channels.map((channel) =>
    toView(channel, actor, memberCounts.get(channel.id) ?? 0, unread.get(channel.id) ?? 0),
  );
}

/** 단건 조회. 접근 권한이 없거나 없는 채널이면 null — '없음'과 '가려짐'을 구분하지 않는다. */
export async function getChannel(
  orgId: string,
  actor: ChannelActor,
  channelId: string,
): Promise<ChannelView | null> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, ...visibleWhere(orgId, actor.userId) },
    include: VIEW_INCLUDE(actor.userId),
  });
  if (!channel) {
    return null;
  }
  // 단건이라 groupBy 대신 count 하나 — 여기서도 필터 없는 전 테이블 집계는 쓰지 않는다.
  const memberCount = await prisma.channelMember.count({ where: { channelId: channel.id } });
  return toView(channel, actor, memberCount);
}

/**
 * 워크스페이스에 기본 채널이 있음을 보장하고, 뷰어를 그 채널에 참여시킨다.
 * 채팅 진입 경로가 매번 호출한다 — 조직 생성 웹훅을 기다리지 않고 첫 접속에서 스스로
 * 부트스트랩하기 위해서다(노트·보드의 스켈레톤 생성과 같은 이유).
 */
export async function ensureDefaultChannel(orgId: string, userId: string): Promise<string> {
  // 삭제된 org·user의 stale 세션이 미러를 부활시키지 못하게 pre/post 이중 확인(KAN-12).
  await assertNotTombstoned([orgId, userId]);

  const [, , created] = await prisma.$transaction([
    orgSkeleton(orgId),
    userSkeleton(userId),
    prisma.channel.createMany({
      data: [
        {
          orgId,
          name: DEFAULT_CHANNEL_NAME,
          topic: DEFAULT_CHANNEL_TOPIC,
          isDefault: true,
        },
      ],
      skipDuplicates: true,
    }),
  ]);

  // createMany가 스킵됐는데 기본 채널이 없다면 누군가 '일반'이라는 이름을 먼저 가져간
  // 것이다(UI 흐름으론 불가능하지만 Server Action 직접 호출로는 가능). 그대로 두면 아래
  // 조회가 throw하면서 그 워크스페이스의 /chat이 영구히 500이 되고, 이름이 이미 점유돼
  // 스스로 회복할 수도 없다 — 그 채널을 기본 채널로 승격시켜 불변식을 되돌린다.
  // 정상 경로에선 매칭이 0건이다(기본 채널의 이름은 언제나 '일반'이고 [orgId,name]은 유일).
  if (created.count === 0) {
    await prisma.channel.updateMany({
      where: { orgId, name: DEFAULT_CHANNEL_NAME, isDefault: false },
      data: { isDefault: true },
    });
  }

  const channel = await prisma.channel.findFirstOrThrow({
    where: { orgId, isDefault: true },
    select: { id: true },
  });
  // 기본 채널 참여는 나갈 수 없다(leaveChannel이 막는다) — 그래서 매 접속의 재참여가
  // 사용자의 '나가기' 의사를 되돌리는 일이 없다.
  await prisma.channelMember.createMany({
    data: [{ channelId: channel.id, userId }],
    skipDuplicates: true,
  });

  await assertNotTombstoned([orgId, userId], async () => {
    await prisma.channelMember.deleteMany({ where: { channelId: channel.id, userId } });
    // 이번 호출이 만든 채널만 되돌린다 — 이미 있던 채널까지 지우면 남의 대화가 사라진다.
    if (created.count > 0) {
      await prisma.channel.deleteMany({ where: { id: channel.id } });
    }
  });

  return channel.id;
}

export async function createChannel(
  orgId: string,
  userId: string,
  input: ChannelInput,
): Promise<ChannelOutcome> {
  const actor = { userId, isAdmin: false };
  await assertNotTombstoned([orgId, userId]);

  let channel: ChannelRow;
  try {
    // 생성자는 곧바로 참여자다 — 비공개 채널이라면 이 행이 접근 권한 그 자체다.
    // 같은 트랜잭션의 userSkeleton이 앞서 실행돼 ChannelMember FK가 성립한다.
    const [, , created] = await prisma.$transaction([
      orgSkeleton(orgId),
      userSkeleton(userId),
      prisma.channel.create({
        data: {
          orgId,
          name: input.name,
          topic: input.topic,
          isPrivate: input.isPrivate,
          createdById: userId,
          members: { create: { userId } },
        },
        include: VIEW_INCLUDE(userId),
      }),
    ]);
    channel = created;
  } catch (error) {
    // [orgId, name] 유니크 위반 — 사전 조회 대신 제약에 맡긴다(동시 생성도 같은 경로).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { status: 'duplicate' };
    }
    throw error;
  }

  await assertNotTombstoned([orgId, userId], async () => {
    await prisma.channel.deleteMany({ where: { id: channel.id } });
  });

  // 방금 만든 채널이라 참여자는 만든 사람 하나뿐이고, 안읽음도 0이다.
  return { status: 'ok', channel: toView(channel, actor, 1) };
}

/** 관리 권한 where — 보이는 채널 중 내가 만든 것, admin이면 보이는 채널 전부. */
function manageWhere(orgId: string, actor: ChannelActor, channelId: string) {
  return {
    id: channelId,
    ...visibleWhere(orgId, actor.userId),
    ...(actor.isAdmin ? {} : { createdById: actor.userId }),
  };
}

export async function updateChannel(
  orgId: string,
  actor: ChannelActor,
  channelId: string,
  input: Pick<ChannelInput, 'name' | 'topic'>,
): Promise<ChannelOutcome> {
  const current = await prisma.channel.findFirst({
    where: { id: channelId, ...visibleWhere(orgId, actor.userId) },
    select: { name: true, isDefault: true, createdById: true },
  });
  if (!current) {
    return { status: 'notfound' };
  }
  if (!actor.isAdmin && current.createdById !== actor.userId) {
    return { status: 'forbidden' };
  }
  if (current.isDefault && input.name !== current.name) {
    return { status: 'default' };
  }

  try {
    // 권한 조건을 where에 실어 원자적으로 반영한다 — 위 조회는 사유 구분용이다(KAN-18).
    // 이름을 바꾸는 요청이면 '기본 채널 아님'도 where에 함께 싣는다(deleteChannel과 같은 형태).
    const { count } = await prisma.channel.updateMany({
      where: {
        ...manageWhere(orgId, actor, channelId),
        ...(input.name === current.name ? {} : { isDefault: false }),
      },
      data: { name: input.name, topic: input.topic },
    });
    if (count === 0) {
      return { status: 'notfound' };
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { status: 'duplicate' };
    }
    throw error;
  }

  const channel = await getChannel(orgId, actor, channelId);
  return channel ? { status: 'ok', channel } : { status: 'notfound' };
}

export type DeleteChannelOutcome = 'ok' | 'forbidden' | 'notfound' | 'default';

export async function deleteChannel(
  orgId: string,
  actor: ChannelActor,
  channelId: string,
): Promise<DeleteChannelOutcome> {
  // 채널 삭제는 그 안의 대화까지 파기한다(messages Cascade) — 사유를 정확히 나눠 돌려준다.
  const current = await prisma.channel.findFirst({
    where: { id: channelId, ...visibleWhere(orgId, actor.userId) },
    select: { isDefault: true, createdById: true },
  });
  if (!current) {
    return 'notfound';
  }
  if (current.isDefault) {
    return 'default';
  }
  if (!actor.isAdmin && current.createdById !== actor.userId) {
    return 'forbidden';
  }

  // 권한·기본채널 조건을 where에 실어 원자적으로 삭제한다(위 조회는 사유 구분용).
  const { count } = await prisma.channel.deleteMany({
    where: { ...manageWhere(orgId, actor, channelId), isDefault: false },
  });
  return count > 0 ? 'ok' : 'notfound';
}
