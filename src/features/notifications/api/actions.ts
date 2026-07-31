'use server';

import { guarded, parseOrError } from '@/lib/action-result';
import { resolveOrg } from '@/server/auth';
import * as notificationService from '@/server/services/notifications';
import type { ActionResult } from '@/lib/action-result';
import { markReadSchema } from '@/features/notifications/validation';

/**
 * 알림 읽음 처리 (KAN-32). ids를 주면 그것만, 없으면 지금 보이는 안읽음 전부.
 * 조회와 달리 변이라 Server Action이 맞다.
 *
 * 남의 알림 id를 섞어 보내도 아무 일도 일어나지 않는다 — 서비스가 updateMany의 where에
 * userId를 실어 매칭 자체가 안 된다. 그래서 '몇 건이 실제로 처리됐는지'를 돌려주고,
 * 요청한 수와 다르다고 실패로 보지 않는다(이미 읽은 것도 0건이다).
 */
export async function markNotificationsReadAction(
  input: unknown,
): Promise<ActionResult<{ read: number }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(markReadSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('notifications.markRead', async () => {
    const read = await notificationService.markRead(org.orgId, org.userId, parsed.data.ids);
    return { ok: true, data: { read } };
  });
}
