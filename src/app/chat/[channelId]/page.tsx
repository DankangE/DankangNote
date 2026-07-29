import { redirect } from 'next/navigation';
import { auth, currentUser } from '@clerk/nextjs/server';
import {
  fetchChannel,
  fetchInvitableMembers,
  fetchMessages,
} from '@/features/chat/api/queries';
import { ChatView } from '@/features/chat/components/ChatView';
import { NoOrganization } from '@/lib/components/NoOrganization';

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  // auth.protect()는 미인증이면 sign-in으로 redirect하고, 인증되면 auth 객체를 반환한다.
  const { userId, orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  const { channelId } = await params;
  const channel = await fetchChannel(channelId);
  // 없는 채널·남의 워크스페이스 채널·미참여 비공개 채널은 모두 같은 결과다. 404 대신
  // 기본 채널로 돌려보낸다 — 워크스페이스를 바꾼 직후 옛 채널 URL에 남아 있는 경우가
  // 가장 흔한 원인이고, 그때 사용자가 할 일은 '채팅으로 돌아가기'뿐이다.
  if (!channel) {
    redirect('/chat');
  }

  // 낙관 전송 말풍선에 쓸 내 표시 정보 — 미러 테이블이 아직 동기화 전일 수 있어
  // Clerk 세션에서 직접 읽는다.
  const user = await currentUser();
  const email = user?.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)
    ?.emailAddress;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || email || userId;

  const messages = await fetchMessages(channel.id);
  // 초대 목록은 비공개 채널에서만 쓴다 — 공개 채널에선 조회 자체를 하지 않는다.
  const invitable = channel.isPrivate ? await fetchInvitableMembers(channel.id) : [];

  return (
    <ChatView
      channel={channel}
      messages={messages}
      viewer={{ id: userId, name, imageUrl: user?.imageUrl ?? null }}
      invitable={invitable}
    />
  );
}
