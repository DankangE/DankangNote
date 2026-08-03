'use client';

import PusherClient from 'pusher-js';

// NEXT_PUBLIC_*은 빌드 시 인라인된다 — 없으면 실시간 없이 동작한다(키 없는 로컬 개발 허용).
const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

/** 실시간이 켜져 있는가. 화면이 '새로고침해야 보인다' 안내를 띄울 근거다. */
export const REALTIME_ENABLED = Boolean(PUSHER_KEY && PUSHER_CLUSTER);

/**
 * 채팅 화면이 공유하는 Pusher 소켓 (KAN-34).
 *
 * 컴포넌트마다 `new PusherClient()`를 하면 구독 하나에 웹소켓 하나가 붙는다. 메시지 구독과
 * 프레즌스 구독은 같은 화면에서 늘 함께 살고 죽으므로 커넥션을 나눠 가질 이유가 없다.
 *
 * 소켓을 React 상태에 담지 않는 이유: effect 안에서 setState로 클라이언트를 흘려보내면
 * 구독하려는 쪽이 첫 렌더를 한 번 헛돌고(react-hooks/set-state-in-effect), 렌더 중에 만들면
 * StrictMode의 이중 렌더가 소켓을 하나 흘린다. 모듈이 들고 refcount로 수명을 세는 쪽이
 * 양쪽 다 없다.
 *
 * 안읽음 훅·알림 벨은 아직 각자 소켓을 연다. 그쪽까지 합치려면 채널 이름 단위 refcount가
 * 필요해서다 — 그 훅들은 지금 보고 있는 채널을 ChatRoom과 겹쳐 구독하므로, 소켓만 공유하면
 * 한쪽의 unsubscribe가 다른 쪽 구독을 조용히 끊는다. 커넥션 정리는 KAN-56의 몫이다.
 */
let shared: PusherClient | null = null;
let holders = 0;
let closing: ReturnType<typeof setTimeout> | null = null;

/**
 * 소켓을 빌린다. 실시간이 꺼진 환경이면 null이고, **그때는 반납하지 않는다**
 * (null을 받은 쪽은 빌린 적이 없다).
 */
export function acquirePusher(): PusherClient | null {
  if (!PUSHER_KEY || !PUSHER_CLUSTER) {
    return null;
  }
  // 마지막 반납 직후 다시 빌리는 중이면 끊기를 취소한다 — 채널을 옮길 때 React는
  // 정리를 먼저 다 돌리고 설치를 시작하므로, 유예가 없으면 이동마다 소켓이 끊겼다 붙는다.
  if (closing) {
    clearTimeout(closing);
    closing = null;
  }
  holders += 1;
  shared ??= new PusherClient(PUSHER_KEY, {
    cluster: PUSHER_CLUSTER,
    channelAuthorization: { transport: 'ajax', endpoint: '/api/pusher/auth' },
  });
  return shared;
}

// 아무도 안 쓰게 된 뒤 실제로 끊기까지의 유예. 이동 중 재취득을 흡수할 만큼만 짧게 둔다.
const CLOSE_GRACE_MS = 1_000;

/** 빌린 소켓을 반납한다. 마지막 반납이면 잠시 뒤 끊는다. */
export function releasePusher(): void {
  holders = Math.max(0, holders - 1);
  if (holders > 0 || closing) {
    return;
  }
  closing = setTimeout(() => {
    closing = null;
    if (holders === 0 && shared) {
      shared.disconnect();
      shared = null;
    }
  }, CLOSE_GRACE_MS);
}
