'use server';

import { revalidatePath } from 'next/cache';
import { guarded, parseOrError } from '@/lib/action-result';
import { resolveOrg } from '@/server/auth';
import * as memberService from '@/server/services/channel-members';
import * as channelService from '@/server/services/channels';
import type { ActionResult } from '@/lib/action-result';
import type { ChannelOutcome } from '@/server/services/channels';
import type { ChannelView } from '@/features/chat/types';
import {
  channelRefSchema,
  createChannelSchema,
  inviteSchema,
  updateChannelSchema,
} from './validation';

// 채널 목록은 서버 컴포넌트(레이아웃)가 그리므로, 변이 후 /chat 하위를 재검증해야
// 사이드바가 따라온다. 메시지 전송과 달리 채널 변경은 드물어 재검증 비용이 문제되지 않는다.
function revalidateChannels(): void {
  revalidatePath('/chat', 'layout');
}

// 서비스가 돌려준 실패 사유를 사용자 문구로. 사유를 한곳에 모아 액션마다 갈리지 않게 한다.
const OUTCOME_ERROR: Record<Exclude<ChannelOutcome['status'], 'ok'>, string> = {
  duplicate: '같은 이름의 채널이 이미 있어요.',
  forbidden: '채널을 만든 사람이나 관리자만 바꿀 수 있어요.',
  notfound: '채널을 찾을 수 없습니다.',
  default: '기본 채널은 이름을 바꾸거나 삭제할 수 없어요.',
  reserved: `'${channelService.DEFAULT_CHANNEL_NAME}'은 기본 채널 이름이라 비공개로 만들 수 없어요.`,
};

export async function createChannelAction(input: unknown): Promise<ActionResult<ChannelView>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(createChannelSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('chat.createChannel', async () => {
    const outcome = await channelService.createChannel(org.orgId, org.userId, parsed.data);
    if (outcome.status !== 'ok') {
      return { ok: false, error: OUTCOME_ERROR[outcome.status] };
    }
    revalidateChannels();
    return { ok: true, data: outcome.channel };
  });
}

export async function updateChannelAction(input: unknown): Promise<ActionResult<ChannelView>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(updateChannelSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('chat.updateChannel', async () => {
    const { id, ...data } = parsed.data;
    const outcome = await channelService.updateChannel(org.orgId, org, id, data);
    if (outcome.status !== 'ok') {
      return { ok: false, error: OUTCOME_ERROR[outcome.status] };
    }
    revalidateChannels();
    return { ok: true, data: outcome.channel };
  });
}

export async function deleteChannelAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(channelRefSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('chat.deleteChannel', async () => {
    const outcome = await channelService.deleteChannel(org.orgId, org, parsed.data.id);
    if (outcome !== 'ok') {
      return { ok: false, error: OUTCOME_ERROR[outcome] };
    }
    revalidateChannels();
    return { ok: true, data: { id: parsed.data.id } };
  });
}

export async function joinChannelAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(channelRefSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('chat.joinChannel', async () => {
    const ok = await memberService.joinChannel(org.orgId, org.userId, parsed.data.id);
    if (!ok) {
      return { ok: false, error: '참여할 수 없는 채널입니다.' };
    }
    revalidateChannels();
    return { ok: true, data: { id: parsed.data.id } };
  });
}

export async function leaveChannelAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(channelRefSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('chat.leaveChannel', async () => {
    const ok = await memberService.leaveChannel(org.orgId, org.userId, parsed.data.id);
    if (!ok) {
      // 참여 중이 아니거나, 기본 채널이거나, 비공개 채널의 마지막 참여자이거나 —
      // 어느 쪽이든 사용자가 할 수 있는 일은 같으므로 한 문구로 안내한다.
      return {
        ok: false,
        error: '나갈 수 없는 채널이에요. 기본 채널과 비공개 채널의 마지막 참여자는 나갈 수 없습니다.',
      };
    }
    revalidateChannels();
    return { ok: true, data: { id: parsed.data.id } };
  });
}

export async function inviteToChannelAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(inviteSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('chat.inviteToChannel', async () => {
    const ok = await memberService.inviteToChannel(
      org.orgId,
      org.userId,
      parsed.data.id,
      parsed.data.userId,
    );
    if (!ok) {
      return { ok: false, error: '초대할 수 없는 멤버이거나 채널입니다.' };
    }
    revalidateChannels();
    return { ok: true, data: { id: parsed.data.userId } };
  });
}
