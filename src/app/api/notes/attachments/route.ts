import { getAuthState } from '@/server/auth';
import * as noteAttachmentService from '@/server/services/note-attachments';
import { presignNoteImageSchema } from '@/features/notes/api/validation';

/**
 * 노트 이미지 업로드 자리 발급 (KAN-38) — pending 행 + 브라우저가 스토리지에 직접 올릴
 * presigned POST. Route Handler인 이유는 채팅 presign과 같다(액션은 직렬화된다, KAN-35).
 * 노트는 org 전체 공개라 채널 접근 판정에 해당하는 것이 없다 — org 멤버면 발급한다.
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
  const parsed = presignNoteImageSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  let outcome: noteAttachmentService.NotePresignOutcome;
  try {
    outcome = await noteAttachmentService.createPendingNoteAttachment(orgId, userId, parsed.data);
  } catch (error) {
    // tombstone 가드(삭제된 조직·계정의 stale 세션)와 그 경합의 FK 위반이 여기로 온다.
    // 채팅 presign과 같은 답이다 — 어느 쪽인지 가르지 않는다(사용자가 할 수 있는 일이 없다).
    console.error('[notes] attachment presign failed:', error);
    return new Response('Not Found', { status: 404 });
  }

  if (outcome.status === 'unavailable') {
    return Response.json(
      { error: '이 환경에는 이미지 저장소가 설정되어 있지 않습니다.' },
      { status: 503 },
    );
  }
  return Response.json({ attachment: outcome.attachment, upload: outcome.upload });
}
