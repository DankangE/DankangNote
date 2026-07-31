'use server';

import { revalidatePath } from 'next/cache';
import { guarded, parseOrError } from '@/lib/action-result';
import { resolveOrg } from '@/server/auth';
import { pusherServer } from '@/server/pusher';
import * as chatService from '@/server/services/chat';
import * as channelReadService from '@/server/services/channel-reads';
import type { ActionResult } from '@/lib/action-result';
import { CHAT_MESSAGE_EVENT, CHAT_REACTION_EVENT, chatChannel } from '@/features/chat/realtime';
import { NOTIFICATION_EVENT, notificationChannel } from '@/features/notifications/realtime';
import type { ChatMessageView, ReactionDelta } from '@/features/chat/types';
import { markChannelReadSchema, sendMessageSchema, toggleReactionSchema } from './validation';

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

// pusher-http-node가 한 번의 trigger에 허용하는 채널 수 상한(라이브러리 하드코딩 값).
const PUSHER_CHANNEL_LIMIT = 100;

/**
 * 멘션된 사람들에게 '새 알림이 있다'만 알린다 (KAN-32).
 *
 * 알림 내용을 싣지 않는 것은 의도적이다 — 페이로드가 커지고, 무엇보다 수신 측이 그걸
 * 그대로 그리면 서버의 가시성 판정(listNotifications)을 건너뛰게 된다. 신호만 받고
 * 목록은 다시 물어보게 한다.
 */
async function broadcastNotifications(orgId: string, userIds: string[]): Promise<void> {
  if (!pusherServer || userIds.length === 0) {
    return;
  }
  try {
    // Pusher는 한 번의 trigger에 100채널까지만 받고, 넘기면 **동기 throw**다 —
    // 초과분만 빠지는 게 아니라 전부 실패한다. @channel 한 번이면 참여자 수만큼 채널이
    // 생기므로 100명이 넘는 채널에서는 아무도 실시간 핑을 못 받게 된다. 잘라서 보낸다.
    for (let index = 0; index < userIds.length; index += PUSHER_CHANNEL_LIMIT) {
      const chunk = userIds.slice(index, index + PUSHER_CHANNEL_LIMIT);
      await pusherServer.trigger(
        chunk.map((userId) => notificationChannel(orgId, userId)),
        NOTIFICATION_EVENT,
        {},
      );
    }
  } catch (error) {
    console.error('[chat] notification broadcast failed:', error);
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
      parsed.data.mentions,
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
    await broadcastNotifications(org.orgId, sent.notified);
    return { ok: true, data: sent.message };
  });
}

/**
 * 채널 읽음 커서를 이 메시지까지 올린다 (KAN-33).
 *
 * 사이드바를 재검증하지 않는다 — 읽는 동안 계속 불리는 액션이라, 매번 레이아웃을 다시
 * 그리면 채널을 보고만 있어도 서버 렌더가 반복된다.
 *
 * 대신 뱃지는 클라이언트가 맞춘다. '다음 이동에서 서버 값이 온다'가 아니다 — Next는
 * 이동만으로 레이아웃을 다시 렌더하지 않으므로 그 값은 페이지를 연 시점에 고정돼 있다.
 * 보고 있는 채널은 0으로 두고, 나머지는 실시간 메시지로 올리고, 소켓이 끊겼다 붙거나
 * 탭이 돌아오면 /api/chat/unread로 다시 맞춘다(use-channel-unread.ts).
 */
export async function markChannelReadAction(input: unknown): Promise<ActionResult<null>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(markChannelReadSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('chat.markChannelRead', async () => {
    const ok = await channelReadService.markChannelRead(
      org.orgId,
      org.userId,
      parsed.data.channelId,
      parsed.data.messageId,
    );
    // 접근할 수 없는 채널이나 그 채널의 것이 아닌 메시지 — 사용자가 할 수 있는 일이 없다.
    if (!ok) {
      return { ok: false, error: '읽음 처리를 할 수 없습니다.' };
    }
    return { ok: true, data: null };
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
