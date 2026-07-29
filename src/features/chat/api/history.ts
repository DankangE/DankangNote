import type { ActionResult } from '@/lib/action-result';
import type { MessagePage, ThreadView } from '@/features/chat/types';

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
