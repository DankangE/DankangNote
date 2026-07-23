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

// 실제 Clerk 페이로드는 수 KB인데 verifyWebhook은 서명 확인 전에 본문 전체를 버퍼링한다 —
// 공개 엔드포인트에 과대 본문을 보내는 메모리 소진 공격을 헤더 수준에서 차단하는 상한.
const MAX_BODY_BYTES = 1_000_000;

export async function POST(req: NextRequest) {
  // 시크릿 미설정은 요청 잘못(400)이 아니라 서버 설정 오류 — 400으로 뭉개면 Clerk
  // 대시보드에서 위조 시도와 구분되지 않아 미러가 조용히 어긋난다. 로그 남기고 5xx.
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) {
    console.error('clerk webhook: CLERK_WEBHOOK_SIGNING_SECRET 미설정');
    return new Response('webhook not configured', { status: 500 });
  }

  // Svix는 항상 content-length를 보낸다 — 부재(chunked 우회)는 411, 상한 초과는 413으로
  // 버퍼링 전에 거절. 비교를 부정형(!(n <= MAX))으로 쓴 것은 비숫자 CL(NaN)이 상한을
  // 통과해 새지 않게 하기 위함 (Node llhttp가 걸러주지만 런타임 가정을 두지 않는다).
  const contentLength = req.headers.get('content-length');
  if (!contentLength) {
    return new Response('length required', { status: 411 });
  }
  if (!(Number(contentLength) <= MAX_BODY_BYTES)) {
    return new Response('payload too large', { status: 413 });
  }

  let evt: WebhookEvent;
  try {
    // CLERK_WEBHOOK_SIGNING_SECRET 환경 변수로 서명을 검증한다. 실패 시 throw.
    evt = await verifyWebhook(req);
  } catch (err) {
    // 페이로드는 로그에 남기지 않는다 — 검증 실패 사유만.
    console.warn('clerk webhook 서명 검증 실패:', err instanceof Error ? err.message : err);
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
