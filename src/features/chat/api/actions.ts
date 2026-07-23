'use server';

import { guarded, parseOrError } from '@/lib/action-result';
import { resolveOrg } from '@/server/auth';
import { pusherServer } from '@/server/pusher';
import * as chatService from '@/server/services/chat';
import type { ActionResult } from '@/lib/action-result';
import { CHAT_MESSAGE_EVENT, orgChannel } from '@/features/chat/realtime';
import type { ChatMessageView } from '@/features/chat/types';
import { messageBodySchema } from './validation';

// 저장 커밋 이후의 브로드캐스트 실패는 전송 실패가 아니다 — 실패로 오보고하면
// 재시도가 중복 메시지를 만든다(notes revalidate와 같은 원칙). 로그만 남긴다.
async function broadcast(orgId: string, message: ChatMessageView): Promise<void> {
  if (!pusherServer) {
    console.warn('[chat] Pusher 미설정 — 실시간 브로드캐스트 생략');
    return;
  }
  try {
    await pusherServer.trigger(orgChannel(orgId), CHAT_MESSAGE_EVENT, message);
  } catch (error) {
    console.error('[chat] broadcast failed:', error);
  }
}

export async function sendMessageAction(input: unknown): Promise<ActionResult<ChatMessageView>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(messageBodySchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('chat.sendMessage', async () => {
    const message = await chatService.createMessage(org.orgId, org.userId, parsed.data);
    await broadcast(org.orgId, message);
    return { ok: true, data: message };
  });
}
