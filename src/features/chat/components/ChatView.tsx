import type {
  ChannelPersonView,
  ChannelView,
  ChatViewer,
  MessagePage,
} from '@/features/chat/types';
import { ChannelHeader } from './ChannelHeader';
import { ChatRoom } from './ChatRoom';

// 채팅 화면 조합. 슬랙 채널처럼 메인 영역 전체 높이를 채운다 — 채널 헤더 + 실시간
// 목록·전송은 각각 클라이언트 경계에 위임한다. 서버 컴포넌트.
export function ChatView({
  channel,
  page,
  viewer,
  roster,
}: {
  channel: ChannelView;
  page: MessagePage;
  viewer: ChatViewer;
  roster: { members: ChannelPersonView[]; invitable: ChannelPersonView[] };
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChannelHeader channel={channel} members={roster.members} invitable={roster.invitable} />
      {/* key로 채널이 바뀔 때 방 상태(메시지 스트림·입력 중인 초안)를 새로 시작한다.
          Next가 동적 세그먼트마다 서브트리를 갈아 끼우므로 지금도 리마운트되지만,
          그 내부 동작에 실시간 스트림의 정확성을 기대지 않는다. */}
      <ChatRoom key={channel.id} channelId={channel.id} initialPage={page} viewer={viewer} />
    </div>
  );
}
