'use server';

import { guarded, parseOrError } from '@/lib/action-result';
import { resolveOrg } from '@/server/auth';
import { pusherServer } from '@/server/pusher';
import * as chatService from '@/server/services/chat';
import type { ActionResult } from '@/lib/action-result';
import { CHAT_MESSAGE_EVENT, chatChannel } from '@/features/chat/realtime';
import type { ChatMessageView } from '@/features/chat/types';
import { sendMessageSchema } from './validation';

// 저장 커밋 이후의 브로드캐스트 실패는 전송 실패가 아니다 — 실패로 오보고하면
// 재시도가 중복 메시지를 만든다(notes revalidate와 같은 원칙). 로그만 남긴다.
async function broadcast(message: ChatMessageView): Promise<void> {
  if (!pusherServer) {
    console.warn('[chat] Pusher 미설정 — 실시간 브로드캐스트 생략');
    return;
  }
  try {
    // 채팅 채널 단위로 쏜다 — 비공개 채널 메시지가 조직 전체로 새지 않는다(KAN-28).
    await pusherServer.trigger(chatChannel(message.channelId), CHAT_MESSAGE_EVENT, message);
  } catch (error) {
    console.error('[chat] broadcast failed:', error);
  }
}

export async function sendMessageAction(input: unknown): Promise<ActionResult<ChatMessageView>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(sendMessageSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('chat.sendMessage', async () => {
    const message = await chatService.createMessage(
      org.orgId,
      org.userId,
      parsed.data.channelId,
      parsed.data.body,
    );
    // 접근할 수 없는 채널(남의 워크스페이스·미참여 비공개)은 '없음'으로 답한다.
    if (!message) {
      return { ok: false, error: '채널을 찾을 수 없습니다.' };
    }
    await broadcast(message);
    return { ok: true, data: message };
  });
}
