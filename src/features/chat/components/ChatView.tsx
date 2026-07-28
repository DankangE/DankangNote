import { Hash } from 'lucide-react';
import type { ChatMessageView, ChatViewer } from '@/features/chat/types';
import { ChatRoom } from './ChatRoom';

// 채팅 화면 조합. 슬랙 채널처럼 메인 영역 전체 높이를 채운다 — 상단 채널 헤더 + 실시간
// 목록·전송은 ChatRoom(클라이언트 경계)에 위임. 서버 컴포넌트.
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
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3 md:px-6">
        <Hash className="size-5 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <h1 className="leading-tight font-semibold tracking-tight">일반</h1>
          <p className="truncate text-xs text-muted-foreground">워크스페이스 멤버 전체 대화</p>
        </div>
      </header>

      <ChatRoom initialMessages={messages} viewer={viewer} orgId={orgId} />
    </div>
  );
}
