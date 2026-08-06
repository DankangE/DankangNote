import { getAuthState } from '@/server/auth';
import * as noteAttachmentService from '@/server/services/note-attachments';

/**
 * 노트 이미지 열람 (KAN-38) — 매 요청 접근 판정 후 짧은 presigned GET으로 302.
 * 본문 `<img src>`가 이 주소를 쓰고, 스토리지 URL은 화면·저장 doc 어디에도 실리지 않는다.
 * 판정 규칙은 services/note-attachments.resolveNoteAttachmentUrl 주석 참조.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId, orgId } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await params;
  const forceDownload = new URL(request.url).searchParams.get('download') === '1';
  const url = await noteAttachmentService.resolveNoteAttachmentUrl(orgId, userId, id, forceDownload);
  // 없는 첨부·볼 수 없는 첨부·스토리지 미설정 전부 같은 404다(존재 오라클 방지).
  if (!url) {
    return new Response('Not Found', { status: 404 });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      // presigned URL이 60초짜리다 — 이 redirect가 캐시에 남으면 만료된 주소로 보낸다.
      'Cache-Control': 'private, no-store',
    },
  });
}
