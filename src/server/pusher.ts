import 'server-only';

import Pusher from 'pusher';

// 키 4종이 모두 있어야 실시간이 켜진다. 없으면 null — 채팅 저장·조회는 그대로
// 동작하고 브로드캐스트·채널 인증만 비활성화된다(키 없는 로컬 개발 허용, KAN-15).
const appId = process.env.PUSHER_APP_ID;
const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
const secret = process.env.PUSHER_SECRET;
const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

export const pusherServer: Pusher | null =
  appId && key && secret && cluster
    ? new Pusher({ appId, key, secret, cluster, useTLS: true })
    : null;
