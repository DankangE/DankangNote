import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { ensureDefaultChannelId } from '@/features/chat/api/queries';
import { NoOrganization } from '@/lib/components/NoOrganization';

// 채팅의 착지점. 워크스페이스의 기본 채널을 보장하고 그리로 보낸다 —
// 새 워크스페이스의 첫 접속에서 채널이 스스로 부트스트랩되는 지점이기도 하다.
export default async function ChatPage() {
  const { orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  redirect(`/chat/${await ensureDefaultChannelId()}`);
}
