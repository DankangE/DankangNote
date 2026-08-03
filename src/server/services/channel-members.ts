import 'server-only';

import { prisma } from '@/server/db';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { visibleWhere } from '@/server/services/channels';
import { userSkeleton } from '@/server/services/skeleton';
import { displayName } from '@/server/services/user-display';

/**
 * 초대 후보·현재 참여자 표시용 최소 정보.
 * email은 동명이인을 가르는 단서다(멘션 후보 목록, KAN-32) — 조직 멤버 페이지가 이미
 * 같은 기준으로 노출하고 있어 새로 열리는 정보는 없다.
 */
export interface ChannelPersonView {
  id: string;
  name: string;
  email: string | null;
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
    // messageSeq는 안읽음 기준선이다 (KAN-55) — 들어오기 전의 대화는 안 읽은 것이 아니다.
    select: { id: true, messageSeq: true },
  });
  if (!channel) {
    return false;
  }

  // 참여도 쓰기다 — 삭제된 org·user의 stale 세션을 tombstone으로 막는다(KAN-12).
  await assertNotTombstoned([orgId, userId]);
  await prisma.$transaction([
    userSkeleton(userId),
    prisma.channelMember.createMany({
      // 순번을 읽고 넣는 사이에 들어온 메시지는 안읽음으로 남는다. 반대로 틀리면(더 큰 값을
      // 박으면) 참여 직전 메시지가 조용히 삼켜지므로, 오차는 이 방향으로만 받는다.
      data: [{ channelId, userId, joinedSeq: channel.messageSeq }],
      skipDuplicates: true,
    }),
  ]);
  await assertNotTombstoned([orgId, userId], async () => {
    await prisma.channelMember.deleteMany({ where: { channelId, userId } });
  });
  return true;
}

/**
 * 채널에서 나간다. 거부되는 두 경우:
 * - 기본 채널 — 다음 접속에서 ensureDefaultChannel이 도로 넣으므로 '나갔다'고 거짓말하지 않는다.
 * - 비공개 채널의 마지막 참여자 — 나가는 순간 그 채널은 아무에게도 보이지 않게 된다.
 *   접근 판정이 곧 참여 행이고 admin 예외도 없으므로, 열람도 재참여도 삭제도 불가능한
 *   고아가 되고 이름은 유니크 제약에 영구히 묶인다(DB를 직접 고치는 것 말고 회복 불가).
 */
export async function leaveChannel(
  orgId: string,
  userId: string,
  channelId: string,
): Promise<boolean> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, orgId, isDefault: false },
    select: { isPrivate: true, _count: { select: { members: true } } },
  });
  if (!channel || (channel.isPrivate && channel._count.members <= 1)) {
    return false;
  }

  const { count } = await prisma.channelMember.deleteMany({
    where: { userId, channel: { id: channelId, orgId, isDefault: false } },
  });
  return count > 0;
}

/**
 * 비공개 채널에 같은 워크스페이스의 멤버를 초대한다. 초대자는 그 채널이 보여야 하고
 * (비공개면 곧 참여자), 대상은 조직 멤버여야 한다. 공개 채널에는 쓸 수 없다.
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
  // 비공개 채널에만 초대가 있다. 공개 채널은 조직 누구나 스스로 들어올 수 있으므로,
  // 여기서 남을 밀어 넣는 건 타인 명의의 쓰기일 뿐이다(isPrivate를 where에 실어 차단).
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, isPrivate: true, ...visibleWhere(orgId, actorId) },
    // 초대받은 사람의 안읽음 기준선 (KAN-55) — joinChannel과 같은 규칙이다.
    select: { id: true, messageSeq: true },
  });
  if (!channel) {
    return false;
  }

  // 삭제된 계정의 stale 세션이 남을 채널에 밀어 넣지 못하게 한다. 여기선 스켈레톤을
  // 만들지 않으므로(아래 참조) 부활 위험이 없어 pre-check 하나로 충분하다.
  await assertNotTombstoned([orgId, actorId]);

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
    data: [{ channelId, userId: inviteeId, joinedSeq: channel.messageSeq }],
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
    email: user.email,
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
    email: user.email,
    imageUrl: user.imageUrl,
  }));
}
