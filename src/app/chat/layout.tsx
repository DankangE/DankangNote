import { auth } from '@clerk/nextjs/server';
import { fetchChannels } from '@/features/chat/api/queries';
import { ChannelSidebar, ChannelStrip } from '@/features/chat/components/ChannelSidebar';
import { NoOrganization } from '@/lib/components/NoOrganization';

// 채팅 셸 — 채널 목록은 채널을 옮겨 다녀도 유지돼야 하므로 레이아웃에서 한 번만 그린다.
// 채널 변이 액션이 revalidatePath('/chat', 'layout')로 이 목록을 갱신한다.
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  const channels = await fetchChannels();

  return (
    <div className="flex h-full min-h-0">
      <ChannelSidebar channels={channels} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 좁은 화면에선 사이드바 대신 가로 스트립으로 채널을 옮겨 다닌다. */}
        <ChannelStrip channels={channels} />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
