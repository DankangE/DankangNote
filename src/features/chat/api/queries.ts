import 'server-only';

import { requireOrg } from '@/server/auth';
import * as memberService from '@/server/services/channel-members';
import * as channelService from '@/server/services/channels';
import * as chatService from '@/server/services/chat';
import type { ChannelPersonView, ChannelView, ChatMessageView } from '@/features/chat/types';

// 서버 컴포넌트에서 직접 호출하는 조회 헬퍼.
// notes와 동일하게 스코프(org·사용자)를 스스로 붙인다 — 호출부가 잊을 여지를 남기지 않는다.

/** 기본 채널을 보장하고 그 id를 준다 — /chat 진입 시 착지할 채널. */
export async function ensureDefaultChannelId(): Promise<string> {
  const { orgId, userId } = await requireOrg();
  return channelService.ensureDefaultChannel(orgId, userId);
}

export async function fetchChannels(): Promise<ChannelView[]> {
  const { orgId, ...actor } = await requireOrg();
  return channelService.listChannels(orgId, actor);
}

export async function fetchChannel(channelId: string): Promise<ChannelView | null> {
  const { orgId, ...actor } = await requireOrg();
  return channelService.getChannel(orgId, actor, channelId);
}

export async function fetchMessages(channelId: string): Promise<ChatMessageView[]> {
  const { orgId, userId } = await requireOrg();
  return chatService.listMessages(orgId, userId, channelId);
}

/** 비공개 채널의 초대 패널이 쓰는 두 목록 — 지금 참여자와 아직 없는 워크스페이스 멤버. */
export async function fetchChannelRoster(channelId: string): Promise<{
  members: ChannelPersonView[];
  invitable: ChannelPersonView[];
}> {
  const { orgId, userId } = await requireOrg();
  const [members, invitable] = await Promise.all([
    memberService.listChannelMembers(orgId, userId, channelId),
    memberService.listInvitableMembers(orgId, userId, channelId),
  ]);
  return { members: members ?? [], invitable: invitable ?? [] };
}
