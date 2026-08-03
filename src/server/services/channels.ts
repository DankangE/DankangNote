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
/**
 * 기본 채널 이름이 비공개 채널에 점유됐을 때 쓰는 대체 이름의 개수 (KAN-53).
 * `일반-2`부터 순서대로 시도한다 — 이름 규칙(validation.ts의 CHANNEL_NAME_PATTERN)을
 * 지켜야 사용자가 나중에 같은 이름을 입력했을 때 같은 채널로 수렴한다.
 */
const FALLBACK_NAME_LIMIT = 20;

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
  | { status: 'default' }
  /** 기본 채널 이름을 비공개 채널이 가져가려 했다 (KAN-53). */
  | { status: 'reserved' };

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
 * 이 채널을 볼 수 있는가만 답한다 (KAN-34).
 *
 * getChannel과 판정 규칙은 같지만(visibleWhere) 뷰를 조립하지 않는다. 타이핑 핑처럼
 * 글을 치는 내내 반복해서 들어오는 경로가 쓰라고 둔 것이다 — 거기서 getChannel을 부르면
 * 쿼리가 매번 둘씩(채널 + 참여자 수) 나가는데, 참여자 수는 쳐다보지도 않는다.
 */
export async function canAccessChannel(
  orgId: string,
  userId: string,
  channelId: string,
): Promise<boolean> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, ...visibleWhere(orgId, userId) },
    select: { id: true },
  });
  return channel !== null;
}

/** 이 이름으로 기본 채널을 만든다. 이름이 이미 있으면 null — 동시 호출의 중재자는 [orgId,name] 유니크다. */
async function createDefaultChannel(orgId: string, name: string): Promise<string | null> {
  try {
    const channel = await prisma.channel.create({
      data: { orgId, name, topic: DEFAULT_CHANNEL_TOPIC, isDefault: true },
      select: { id: true },
    });
    return channel.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return null;
    }
    throw error;
  }
}

/** 지금 이 워크스페이스의 기본 채널. 경합에서 진 쪽이 이긴 쪽의 결과를 집어 가는 지점이기도 하다. */
function findDefaultChannel(orgId: string): Promise<{ id: string } | null> {
  return prisma.channel.findFirst({ where: { orgId, isDefault: true }, select: { id: true } });
}

/**
 * 워크스페이스의 기본 채널을 확정한다. `created`는 '이번 호출이 만들었는가' —
 * tombstone 롤백이 남의 채널을 지우지 않게 하는 근거다.
 *
 * 만들기에 실패할 때마다 곧바로 '지금 기본 채널이 있는가'를 다시 본다. 이 재조회가
 * 동시 호출을 하나로 접는다 — 유니크 제약에서 진 쪽은 이긴 쪽의 채널을 그대로 쓰고,
 * 다음 후보 이름으로 넘어가 두 번째 기본 채널을 만들지 않는다.
 */
async function resolveDefaultChannel(orgId: string): Promise<{ id: string; created: boolean }> {
  // 이미 있으면 끝. 만들기보다 조회를 먼저 두는 이유는 아래 대체 경로 때문이다 — 기본
  // 채널이 '일반'이 아닌 이름으로 서 있을 수 있고, 그때 '일반'을 새로 만들면 기본 채널이
  // 둘로 갈라진다(점유하던 비공개 채널이 나중에 삭제되면 실제로 그렇게 된다).
  const current = await findDefaultChannel(orgId);
  if (current) {
    return { id: current.id, created: false };
  }

  const bootstrapped = await createDefaultChannel(orgId, DEFAULT_CHANNEL_NAME);
  if (bootstrapped) {
    return { id: bootstrapped, created: true };
  }

  // 이름이 이미 있다 = 누군가 '일반'을 먼저 가져갔다(UI 흐름으론 불가능하지만 Server
  // Action 직접 호출로는 가능). 공개 채널이면 승격시켜 불변식을 되돌린다.
  //
  // 비공개 채널은 승격시키지 않는다 (KAN-53). 승격 직후 아래에서 호출자를 참여시키는데,
  // 비공개 채널에서 그 행은 곧 접근 권한 그 자체다(visibleWhere) — 조직 전원이 남의
  // 비공개 대화에 차례로 강제 참여되고, 기본 채널은 나가기·이름 변경·삭제가 전부 막혀
  // 있어 admin조차 앱 안에서 되돌릴 수 없다. 비공개를 공개로 바꾸는 것도 답이 아니다:
  // 과거 대화가 통째로 열린다.
  await prisma.channel.updateMany({
    where: { orgId, name: DEFAULT_CHANNEL_NAME, isPrivate: false, isDefault: false },
    data: { isDefault: true },
  });

  const promoted = await findDefaultChannel(orgId);
  if (promoted) {
    return { id: promoted.id, created: false };
  }

  // 비공개 채널이 이름을 점유했다. 이름을 양보하고 충돌하지 않는 이름으로 만든다 —
  // 여기서 포기하면 findFirstOrThrow가 던져 그 워크스페이스의 /chat이 영구히 500이 되고,
  // 이름이 점유된 채라 스스로 회복할 수도 없다.
  for (let suffix = 2; suffix <= FALLBACK_NAME_LIMIT; suffix += 1) {
    const fallback = await createDefaultChannel(orgId, `${DEFAULT_CHANNEL_NAME}-${suffix}`);
    if (fallback) {
      return { id: fallback, created: true };
    }
    const winner = await findDefaultChannel(orgId);
    if (winner) {
      return { id: winner.id, created: false };
    }
  }

  throw new Error(`기본 채널 이름 후보를 모두 소진했습니다 (orgId=${orgId})`);
}

/**
 * 워크스페이스에 기본 채널이 있음을 보장하고, 뷰어를 그 채널에 참여시킨다.
 * 채팅 진입 경로가 매번 호출한다 — 조직 생성 웹훅을 기다리지 않고 첫 접속에서 스스로
 * 부트스트랩하기 위해서다(노트·보드의 스켈레톤 생성과 같은 이유).
 */
export async function ensureDefaultChannel(orgId: string, userId: string): Promise<string> {
  // 삭제된 org·user의 stale 세션이 미러를 부활시키지 못하게 pre/post 이중 확인(KAN-12).
  await assertNotTombstoned([orgId, userId]);

  // 스켈레톤이 먼저다 — Channel.orgId와 ChannelMember.userId의 FK가 미러 행에 매달려 있다.
  await prisma.$transaction([orgSkeleton(orgId), userSkeleton(userId)]);

  const { id: channelId, created } = await resolveDefaultChannel(orgId);

  // 기본 채널 참여는 나갈 수 없다(leaveChannel이 막는다) — 그래서 매 접속의 재참여가
  // 사용자의 '나가기' 의사를 되돌리는 일이 없다.
  //
  // joinedSeq는 지금 채널 순번이다 (KAN-55). 이 채널은 워크스페이스에 이미 있었을 수 있어,
  // 0으로 두면 새 멤버의 첫 접속에 그동안의 대화 전체가 안읽음으로 뜬다. 이미 참여 중이면
  // skipDuplicates가 막아 기준선은 그대로다.
  const { messageSeq } = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: { messageSeq: true },
  });
  await prisma.channelMember.createMany({
    data: [{ channelId, userId, joinedSeq: messageSeq }],
    skipDuplicates: true,
  });

  await assertNotTombstoned([orgId, userId], async () => {
    await prisma.channelMember.deleteMany({ where: { channelId, userId } });
    // 이번 호출이 만든 채널만 되돌린다 — 이미 있던 채널까지 지우면 남의 대화가 사라진다.
    if (created) {
      await prisma.channel.deleteMany({ where: { id: channelId } });
    }
  });

  return channelId;
}

export async function createChannel(
  orgId: string,
  userId: string,
  input: ChannelInput,
): Promise<ChannelOutcome> {
  const actor = { userId, isAdmin: false };

  // 기본 채널 이름은 비공개 채널이 가져갈 수 없다 (KAN-53). 점유되면 ensureDefaultChannel이
  // 그 이름을 쓰지 못해 대체 이름으로 밀려나고, 워크스페이스의 기본 채널이 영영 '일반'이
  // 아니게 된다(기본 채널은 이름을 바꿀 수 없어 되돌릴 수도 없다). 공개 채널은 허용한다 —
  // 승격되더라도 어차피 조직 전체가 볼 수 있던 채널이라 새로 열리는 대화가 없다.
  if (input.isPrivate && input.name === DEFAULT_CHANNEL_NAME) {
    return { status: 'reserved' };
  }

  await assertNotTombstoned([orgId, userId]);

  let channel: ChannelRow;
  try {
    // 생성자는 곧바로 참여자다 — 비공개 채널이라면 이 행이 접근 권한 그 자체다.
    // 같은 트랜잭션의 userSkeleton이 앞서 실행돼 ChannelMember FK가 성립한다.
    //
    // joinedSeq를 안 적는 유일한 참여 지점이다 (KAN-55). 방금 만든 채널이라 messageSeq도
    // 0이고 기본값 0이 곧 맞는 값이기 때문이다. 이 create가 **이미 있는 채널**에 사람을
    // 붙이는 형태로 바뀌면 그 순간 틀린다 — 기준선이 0이면 그동안의 대화가 통째로
    // 안읽음으로 뜬다. 그때는 다른 참여 지점들처럼 지금 순번을 읽어 실어야 한다.
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
    select: { name: true, isPrivate: true, isDefault: true, createdById: true },
  });
  if (!current) {
    return { status: 'notfound' };
  }
  if (!actor.isAdmin && current.createdById !== actor.userId) {
    return { status: 'forbidden' };
  }
  // 개명도 점유다 (KAN-53). createChannel에서만 예약 이름을 막으면 '비밀'로 만든 뒤
  // '일반'으로 바꾸는 두 걸음이 그 가드를 그대로 우회한다. 이름을 바꾸는 요청일 때만
  // 본다 — 이미 그 이름인 레거시 채널의 주제 수정까지 막을 이유는 없다.
  if (current.isPrivate && input.name === DEFAULT_CHANNEL_NAME && input.name !== current.name) {
    return { status: 'reserved' };
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
