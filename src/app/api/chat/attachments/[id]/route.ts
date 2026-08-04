import { getAuthState } from '@/server/auth';
import * as attachmentService from '@/server/services/attachments';

/**
 * 첨부 열람·다운로드 (KAN-35). 매 요청 접근 판정을 통과하면 짧은(60초) presigned GET으로
 * 302 한다 — `<img src>`와 다운로드 링크가 이 주소 하나를 쓰고, 스토리지 URL은 화면에
 * 실리지 않는다. 판정 규칙은 services/attachments.resolveDownloadUrl 주석 참조.
 *
 * `?download=1`이면 이미지도 Content-Disposition: attachment로 내린다.
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
  const url = await attachmentService.resolveDownloadUrl(orgId, userId, id, forceDownload);
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
