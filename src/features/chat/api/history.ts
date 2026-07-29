import type { ActionResult } from '@/lib/action-result';
import type { MessagePage } from '@/features/chat/types';

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
