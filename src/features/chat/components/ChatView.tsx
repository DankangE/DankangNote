import type { ChannelPersonView, ChannelView, ChatMessageView, ChatViewer } from '@/features/chat/types';
import { ChannelHeader } from './ChannelHeader';
import { ChatRoom } from './ChatRoom';

// 채팅 화면 조합. 슬랙 채널처럼 메인 영역 전체 높이를 채운다 — 채널 헤더 + 실시간
// 목록·전송은 각각 클라이언트 경계에 위임한다. 서버 컴포넌트.
export function ChatView({
  channel,
  messages,
  viewer,
  invitable,
}: {
  channel: ChannelView;
  messages: ChatMessageView[];
  viewer: ChatViewer;
  invitable: ChannelPersonView[];
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChannelHeader channel={channel} invitable={invitable} />
      {/* key로 채널이 바뀔 때 방 상태(메시지 스트림·입력 중인 초안)를 새로 시작한다 —
          이전 채널의 낙관 말풍선이 다음 채널로 흘러가지 않게. */}
      <ChatRoom
        key={channel.id}
        channelId={channel.id}
        initialMessages={messages}
        viewer={viewer}
      />
    </div>
  );
}
