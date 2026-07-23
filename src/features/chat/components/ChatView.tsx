import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
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
      <Stack direction="vertical" gap={1}>
        <Heading level={1}>채팅</Heading>
        <Text color="secondary">워크스페이스 멤버들과의 실시간 대화</Text>
      </Stack>

      <ChatRoom initialMessages={messages} viewer={viewer} orgId={orgId} />
    </CenteredPage>
  );
}
