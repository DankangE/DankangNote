import type { NextRequest } from 'next/server';

import type { WebhookEvent } from '@clerk/nextjs/webhooks';
import { verifyWebhook } from '@clerk/nextjs/webhooks';

import {
  deleteMembership,
  deleteOrganization,
  deleteUser,
  upsertMembership,
  upsertOrganization,
  upsertUser,
} from '@/server/services/clerk-sync';

// Clerk 웹훅 수신 엔드포인트. 외부 노출이 필요한 경우라 Server Action이 아닌 Route Handler.
// 페이로드 검증은 zod 대신 Svix 서명 검증(verifyWebhook)이 담당한다 — 서명이 유효하면
// 본문은 Clerk가 보낸 원본 그대로임이 보장되고, 타입은 @clerk/nextjs의 판별 유니언을 쓴다.
export async function POST(req: NextRequest) {
  let evt: WebhookEvent;
  try {
    // CLERK_WEBHOOK_SIGNING_SECRET 환경 변수로 서명을 검증한다. 실패 시 throw.
    evt = await verifyWebhook(req);
  } catch {
    return new Response('webhook signature verification failed', { status: 400 });
  }

  try {
    switch (evt.type) {
      case 'user.created':
      case 'user.updated':
        await upsertUser(evt.data);
        break;
      case 'user.deleted':
        // deleted 페이로드(DeletedObjectJSON)의 id는 optional — 없으면 지울 대상이 없다.
        if (evt.data.id) await deleteUser(evt.data.id);
        break;
      case 'organization.created':
      case 'organization.updated':
        await upsertOrganization(evt.data);
        break;
      case 'organization.deleted':
        if (evt.data.id) await deleteOrganization(evt.data.id);
        break;
      case 'organizationMembership.created':
      case 'organizationMembership.updated':
        await upsertMembership(evt.data);
        break;
      case 'organizationMembership.deleted':
        await deleteMembership(evt.data.id);
        break;
      default:
        // 구독하지 않는 이벤트는 정상 응답으로 무시 (Clerk 재시도 방지)
        break;
    }
  } catch (err) {
    console.error(`clerk webhook 처리 실패 (${evt.type})`, err);
    // 5xx면 Clerk(Svix)가 백오프로 재전송한다 — 일시적 DB 장애의 복구 경로
    return new Response('webhook handler failed', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}
