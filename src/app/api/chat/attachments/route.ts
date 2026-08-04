import { getAuthState } from '@/server/auth';
import * as attachmentService from '@/server/services/attachments';
import { presignAttachmentSchema } from '@/features/chat/api/validation';

/**
 * 첨부 업로드 자리 발급 (KAN-35) — pending 행 + 브라우저가 스토리지에 직접 올릴
 * presigned POST를 돌려준다.
 *
 * **Server Action이 아니라 Route Handler다.** 파일 여러 개를 고르면 presign이 병렬로
 * 나가는데, 액션은 한 줄로 직렬화돼 업로드 준비가 파일 수만큼 순차로 밀린다(타이핑 핑·이력
 * 조회를 Route Handler로 둔 것과 같은 이유).
 */
export async function POST(request: Request) {
  const { userId, orgId } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const parsed = presignAttachmentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  let outcome: attachmentService.PresignOutcome;
  try {
    outcome = await attachmentService.createPendingAttachment(orgId, userId, parsed.data.channelId, {
      fileName: parsed.data.fileName,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
    });
  } catch (error) {
    // tombstone 가드(삭제된 조직·계정의 stale 세션)와 그 경합의 FK 위반이 여기로 온다.
    // 어느 쪽인지 가르지 않는다 — 사용자가 할 수 있는 일이 없는 건 같다.
    console.error('[chat] attachment presign failed:', error);
    return new Response('Not Found', { status: 404 });
  }

  if (outcome.status === 'unavailable') {
    return new Response('attachment storage not configured', { status: 503 });
  }
  // 접근할 수 없는 채널 — 없는 채널과 같은 404다(존재 오라클 방지, 타이핑 라우트와 같다).
  if (outcome.status === 'notfound') {
    return new Response('Not Found', { status: 404 });
  }

  return Response.json({ attachment: outcome.attachment, upload: outcome.upload });
}
