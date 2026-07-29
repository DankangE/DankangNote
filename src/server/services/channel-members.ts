import 'server-only';

import { prisma } from '@/server/db';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { visibleWhere } from '@/server/services/channels';
import { userSkeleton } from '@/server/services/skeleton';
import { displayName } from '@/server/services/user-display';

/** 초대 후보·현재 참여자 표시용 최소 정보. */
export interface ChannelPersonView {
  id: string;
  name: string;
  imageUrl: string | null;
}

const PERSON_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  imageUrl: true,
} as const;

/**
 * 공개 채널에 스스로 참여한다. 비공개 채널은 초대(invite)로만 들어갈 수 있으므로
 * isPrivate: false를 where에 실어 아예 매칭되지 않게 한다.
 */
export async function joinChannel(
  orgId: string,
  userId: string,
  channelId: string,
): Promise<boolean> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, orgId, isPrivate: false },
    select: { id: true },
  });
  if (!channel) {
    return false;
  }

  // 참여도 쓰기다 — 삭제된 org·user의 stale 세션을 tombstone으로 막는다(KAN-12).
  await assertNotTombstoned([orgId, userId]);
  await prisma.$transaction([
    userSkeleton(userId),
    prisma.channelMember.createMany({ data: [{ channelId, userId }], skipDuplicates: true }),
  ]);
  await assertNotTombstoned([orgId, userId], async () => {
    await prisma.channelMember.deleteMany({ where: { channelId, userId } });
  });
  return true;
}

/**
 * 채널에서 나간다. 기본 채널은 나갈 수 없다 — 다음 접속에서 ensureDefaultChannel이
 * 도로 넣을 것이므로, 사용자에게 '나갔다'고 거짓말하지 않는다.
 */
export async function leaveChannel(
  orgId: string,
  userId: string,
  channelId: string,
): Promise<boolean> {
  const { count } = await prisma.channelMember.deleteMany({
    where: { userId, channel: { id: channelId, orgId, isDefault: false } },
  });
  return count > 0;
}

/**
 * 비공개 채널에 같은 워크스페이스의 멤버를 초대한다. 초대자는 그 채널이 보여야 하고
 * (비공개면 곧 참여자), 대상은 조직 멤버여야 한다.
 *
 * 대상이 조직 멤버인지는 Membership 미러로 본다. 미러는 표시용이라는 원칙(KAN-18)과
 * 어긋나 보이지만, 여기서 미러는 '후보 목록'일 뿐이다 — 실제 게이트는 초대된 사람이
 * 자기 세션의 orgId로 채널에 접근할 때 다시 걸린다. 웹훅이 지연되면 초대가 잠시 안 될
 * 뿐이고(fail-closed), 이미 퇴출된 사람이 미러에 남아 초대돼도 세션에 org가 없어
 * 접근하지 못한다.
 */
export async function inviteToChannel(
  orgId: string,
  actorId: string,
  channelId: string,
  inviteeId: string,
): Promise<boolean> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, ...visibleWhere(orgId, actorId) },
    select: { id: true },
  });
  if (!channel) {
    return false;
  }

  const membership = await prisma.membership.findFirst({
    where: { orgId, userId: inviteeId },
    select: { userId: true },
  });
  if (!membership) {
    return false;
  }

  // Membership이 있다는 건 User 미러 행이 이미 있다는 뜻(FK)이라 스켈레톤이 필요 없고,
  // tombstone된 사용자는 cascade로 Membership이 사라져 여기 걸리지 않는다.
  await prisma.channelMember.createMany({
    data: [{ channelId, userId: inviteeId }],
    skipDuplicates: true,
  });
  return true;
}

/** 채널 참여자 목록. 접근 권한이 없으면 null. */
export async function listChannelMembers(
  orgId: string,
  userId: string,
  channelId: string,
): Promise<ChannelPersonView[] | null> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, ...visibleWhere(orgId, userId) },
    select: { id: true },
  });
  if (!channel) {
    return null;
  }

  const members = await prisma.channelMember.findMany({
    where: { channelId },
    include: { user: { select: PERSON_SELECT } },
    orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
  });
  return members.map(({ user }) => ({
    id: user.id,
    name: displayName(user),
    imageUrl: user.imageUrl,
  }));
}

/** 아직 이 채널에 없는 워크스페이스 멤버 — 초대 목록에 그대로 쓴다. */
export async function listInvitableMembers(
  orgId: string,
  userId: string,
  channelId: string,
): Promise<ChannelPersonView[] | null> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, ...visibleWhere(orgId, userId) },
    select: { id: true },
  });
  if (!channel) {
    return null;
  }

  const candidates = await prisma.membership.findMany({
    where: { orgId, user: { channelMembers: { none: { channelId } } } },
    include: { user: { select: PERSON_SELECT } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return candidates.map(({ user }) => ({
    id: user.id,
    name: displayName(user),
    imageUrl: user.imageUrl,
  }));
}
