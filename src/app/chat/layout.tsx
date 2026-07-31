import { auth } from '@clerk/nextjs/server';
import { fetchChannels } from '@/features/chat/api/queries';
import { ChannelNav } from '@/features/chat/components/ChannelNav';
import { NoOrganization } from '@/lib/components/NoOrganization';

// 채팅 셸 — 채널 목록은 채널을 옮겨 다녀도 유지돼야 하므로 레이아웃에서 한 번만 그린다.
// 채널 변이 액션이 revalidatePath('/chat', 'layout')로 이 목록을 갱신한다.
// 셸 자체는 ChannelNav(클라이언트)가 그린다 — 안읽음 뱃지가 실시간으로 오르려면 사이드바와
// 모바일 스트립이 같은 클라이언트 상태를 봐야 하기 때문이다(KAN-33).
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const { userId, orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  const channels = await fetchChannels();

  return (
    <ChannelNav channels={channels} viewerId={userId}>
      {children}
    </ChannelNav>
  );
}
