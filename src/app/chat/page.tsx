import { auth, currentUser } from '@clerk/nextjs/server';
import { fetchMessages } from '@/features/chat/api/queries';
import { ChatView } from '@/features/chat/components/ChatView';
import { NoOrganization } from '@/lib/components/NoOrganization';

export default async function ChatPage() {
  // auth.protect()는 미인증이면 sign-in으로 redirect하고, 인증되면 auth 객체를 반환한다.
  const { userId, orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  // 낙관 전송 말풍선에 쓸 내 표시 정보 — 미러 테이블이 아직 동기화 전일 수 있어
  // Clerk 세션에서 직접 읽는다.
  const user = await currentUser();
  const email = user?.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)
    ?.emailAddress;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || email || userId;

  const messages = await fetchMessages();
  return (
    <ChatView
      messages={messages}
      viewer={{ id: userId, name, imageUrl: user?.imageUrl ?? null }}
      orgId={orgId}
    />
  );
}
