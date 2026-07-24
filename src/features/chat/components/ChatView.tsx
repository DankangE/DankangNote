import { CenteredPage } from '@/lib/components/CenteredPage';
import type { ChatMessageView, ChatViewer } from '@/features/chat/types';
import { ChatRoom } from './ChatRoom';

// 채팅 화면 조합. 서버 컴포넌트 — 헤더만 두고 실시간 목록·전송은 ChatRoom에 위임.
export function ChatView({
  messages,
  viewer,
  orgId,
}: {
  messages: ChatMessageView[];
  viewer: ChatViewer;
  orgId: string;
}) {
  return (
    <CenteredPage>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">채팅</h1>
        <p className="text-muted-foreground">워크스페이스 멤버들과의 실시간 대화</p>
      </div>

      <ChatRoom initialMessages={messages} viewer={viewer} orgId={orgId} />
    </CenteredPage>
  );
}
