import type { ActionResult } from '@/lib/action-result';
import type { ChannelPersonView, MessagePage, ThreadView } from '@/features/chat/types';
import type { MentionCandidate } from '@/features/chat/components/MentionSuggestions';

// 이력 로딩만 Server Action이 아닌 Route Handler를 쓴다(이유는 app/api/chat/messages/route.ts).
// 호출부가 액션과 같은 모양으로 다루도록 반환은 ActionResult 계약을 그대로 따른다.

const GENERIC_ERROR = '이전 메시지를 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
// 401은 세션 만료다 — '잠시 후 다시'로 뭉개면 사용자가 새로고침해야 한다는 걸 알 수 없다.
const SIGNED_OUT_ERROR = '로그인이 만료됐어요. 새로고침한 뒤 다시 시도해주세요.';

export async function fetchOlderMessages(
  channelId: string,
  before: string,
): Promise<ActionResult<MessagePage>> {
  const query = new URLSearchParams({ channelId, before });
  const response = await fetch(`/api/chat/messages?${query}`);
  if (!response.ok) {
    return { ok: false, error: response.status === 401 ? SIGNED_OUT_ERROR : GENERIC_ERROR };
  }
  return { ok: true, data: (await response.json()) as MessagePage };
}

/**
 * 멘션 후보 = 이 채널의 참여자 (KAN-32).
 * 실패해도 던지지 않고 빈 목록을 준다 — 자동완성이 안 뜰 뿐, 전송은 그대로 된다.
 */
export async function fetchMentionCandidates(channelId: string): Promise<MentionCandidate[]> {
  const response = await fetch(`/api/chat/members?channelId=${encodeURIComponent(channelId)}`).catch(
    () => null,
  );
  if (!response?.ok) {
    return [];
  }
  const people = (await response.json()) as ChannelPersonView[];
  return people.map((person) => ({
    kind: 'user' as const,
    userId: person.id,
    label: person.name,
    // 동명이인을 가르는 단서. 미러가 비어 이름이 id로 떨어진 경우엔 중복이라 감춘다.
    hint: person.email && person.email !== person.name ? person.email : null,
    imageUrl: person.imageUrl,
  }));
}

const THREAD_GONE_ERROR = '스레드를 찾을 수 없어요. 삭제됐거나 볼 수 없는 메시지입니다.';

/** 스레드 열기 / 이전 답글 더 보기. before 없이 부르면 최신 답글 페이지다. */
export async function fetchThread(
  rootId: string,
  before?: string,
): Promise<ActionResult<ThreadView>> {
  const query = new URLSearchParams({ rootId });
  if (before) {
    query.set('before', before);
  }
  const response = await fetch(`/api/chat/thread?${query}`);
  if (!response.ok) {
    if (response.status === 401) {
      return { ok: false, error: SIGNED_OUT_ERROR };
    }
    return { ok: false, error: response.status === 404 ? THREAD_GONE_ERROR : GENERIC_ERROR };
  }
  return { ok: true, data: (await response.json()) as ThreadView };
}

/**
 * 내 채널들의 안읽음 수 (KAN-33). 실패하면 null — 호출부가 지금 값을 그대로 둔다.
 * 뱃지는 부가 정보라 못 맞췄다고 비우는 쪽이 더 나쁘다.
 */
export async function fetchUnreadCounts(): Promise<Record<string, number> | null> {
  try {
    const response = await fetch('/api/chat/unread');
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Record<string, number>;
  } catch {
    // 네트워크가 끊긴 경우 — 지금 값을 그대로 둔다(호출부가 null을 그렇게 다룬다).
    return null;
  }
}
