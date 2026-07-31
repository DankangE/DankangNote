'use server';

import { revalidatePath } from 'next/cache';
import { guarded, parseOrError } from '@/lib/action-result';
import { resolveOrg } from '@/server/auth';
import { pusherServer } from '@/server/pusher';
import * as chatService from '@/server/services/chat';
import type { ActionResult } from '@/lib/action-result';
import { CHAT_MESSAGE_EVENT, CHAT_REACTION_EVENT, chatChannel } from '@/features/chat/realtime';
import type { ChatMessageView, ReactionDelta } from '@/features/chat/types';
import { sendMessageSchema, toggleReactionSchema } from './validation';

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

// 리액션도 같은 이유로 실패를 삼킨다 — DB 토글은 이미 커밋됐고, 재시도하면 토글이 한 번 더
// 돌아 방금 누른 것이 취소된다.
async function broadcastReaction(delta: ReactionDelta): Promise<void> {
  if (!pusherServer) {
    return;
  }
  try {
    await pusherServer.trigger(chatChannel(delta.channelId), CHAT_REACTION_EVENT, delta);
  } catch (error) {
    console.error('[chat] reaction broadcast failed:', error);
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
      parsed.data.parentId,
    );
    // 접근할 수 없는 채널(남의 워크스페이스·미참여 비공개)이나 답글을 달 수 없는 부모는
    // '없음'으로 답한다 — 어느 쪽인지 알려주면 그 자체가 존재 여부 오라클이 된다.
    if (!sent) {
      return { ok: false, error: '메시지를 보낼 대상을 찾을 수 없습니다.' };
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
 * 이모지 리액션 토글 (KAN-31).
 *
 * 브로드캐스트와 응답이 같은 델타를 싣는다 — 누른 본인은 응답으로, 나머지는 Pusher로 같은
 * 절대 상태를 받는다. Pusher가 꺼진 환경에서도 누른 사람 화면은 응답만으로 맞는다.
 */
export async function toggleReactionAction(input: unknown): Promise<ActionResult<ReactionDelta>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(toggleReactionSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('chat.toggleReaction', async () => {
    const delta = await chatService.toggleReaction(
      org.orgId,
      org.userId,
      parsed.data.messageId,
      parsed.data.emoji,
    );
    // 볼 수 없는 메시지와 없는 메시지를 같은 문구로 답한다 — 갈리면 그게 존재 오라클이다.
    if (!delta) {
      return { ok: false, error: '리액션할 메시지를 찾을 수 없습니다.' };
    }
    await broadcastReaction(delta);
    return { ok: true, data: delta };
  });
}
