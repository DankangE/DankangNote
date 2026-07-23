import 'server-only';

import { requireOrgId } from '@/server/auth';
import * as chatService from '@/server/services/chat';
import type { ChatMessageView } from '@/features/chat/types';

// 서버 컴포넌트에서 직접 호출하는 조회 헬퍼.
// notes와 동일하게 orgId 스코프를 스스로 붙인다(자기 스코프 보장).

export async function fetchMessages(): Promise<ChatMessageView[]> {
  const orgId = await requireOrgId();
  return chatService.listMessages(orgId);
}
