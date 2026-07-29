'use server';

import { revalidatePath } from 'next/cache';
import { guarded, parseOrError } from '@/lib/action-result';
import { resolveOrg } from '@/server/auth';
import { pusherServer } from '@/server/pusher';
import * as chatService from '@/server/services/chat';
import type { ActionResult } from '@/lib/action-result';
import { CHAT_MESSAGE_EVENT, chatChannel } from '@/features/chat/realtime';
import type { ChatMessageView, MessagePage } from '@/features/chat/types';
import { olderMessagesSchema, sendMessageSchema } from './validation';

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
    const sent = await chatService.createMessage(
      org.orgId,
      org.userId,
      parsed.data.channelId,
      parsed.data.body,
    );
    // 접근할 수 없는 채널(남의 워크스페이스·미참여 비공개)은 '없음'으로 답한다.
    if (!sent) {
      return { ok: false, error: '채널을 찾을 수 없습니다.' };
    }
    // 평소엔 재검증하지 않는다 — 메시지는 Pusher로 흐르고, 매 전송마다 레이아웃을 다시
    // 그리면 낭비다. 자동 참여가 일어난 첫 전송에서만 채널 목록을 갱신한다(그 채널이
    // '둘러보기'에서 '내 채널'로 옮겨가야 하는데, 레이아웃은 이동만으론 다시 불리지 않는다).
    if (sent.joined) {
      revalidatePath('/chat', 'layout');
    }
    await broadcast(sent.message);
    return { ok: true, data: sent.message };
  });
}

/**
 * 위로 스크롤할 때의 이전 페이지. 조회지만 Server Action으로 두는 이유는 클라이언트가
 * 임의 시점에 호출해야 해서다(RSC 조회는 렌더 시점에 묶인다). 접근 판정은 전송과 똑같이
 * 서비스의 채널 스코프가 한다 — 액션이 별도 규칙을 갖지 않는다.
 */
export async function loadOlderMessagesAction(input: unknown): Promise<ActionResult<MessagePage>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(olderMessagesSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('chat.loadOlderMessages', async () => {
    const page = await chatService.listMessages(
      org.orgId,
      org.userId,
      parsed.data.channelId,
      parsed.data.before,
    );
    return { ok: true, data: page };
  });
}
