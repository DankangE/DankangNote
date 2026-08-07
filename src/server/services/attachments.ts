import 'server-only';

import { prisma } from '@/server/db';
import {
  attachmentKeyPrefix,
  presignAttachmentDownload,
  presignAttachmentUpload,
  storage,
} from '@/server/storage';
import { canAccessChannel, visibleWhere } from '@/server/services/channels';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { isInlineImage } from '@/lib/attachments';
import type { AttachmentView } from '@/features/chat/types';
import type { UploadTicket } from '@/server/storage';

// 첨부 서비스 (KAN-35) — presign 발급과 다운로드 URL 해석. 메시지 바인딩은 전송 트랜잭션의
// 일부라 chat.createMessage에 있다(바인딩이 메시지 생성과 원자적이어야 하기 때문).

export type PresignOutcome =
  | { status: 'ok'; attachment: AttachmentView; upload: UploadTicket }
  /** 스토리지 env 미설정 — 첨부 기능이 꺼진 환경. */
  | { status: 'unavailable' }
  /** 접근할 수 없는 채널. 없는 채널과 같은 답이다(존재 오라클 방지). */
  | { status: 'notfound' };

export function toAttachmentView(row: {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
}): AttachmentView {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
  };
}

/**
 * 업로드 자리를 만든다 — pending 행(messageId null) + 브라우저가 스토리지에 직접 올릴
 * presigned POST. 크기·타입 상한의 강제는 POST 정책이 스토리지 수준에서 한다(storage.ts).
 *
 * 행을 presign과 함께 만드는 이유: 바인딩(sendMessage)이 '이 워크스페이스·이 채널·내
 * 업로드'를 물을 근거가 행이다. 행 없이 키만 발급하면 전송 시점에 그 주장을 검증할 데가
 * 없다. 전송 없이 버려진 pending 행은 채널·조직 cascade로 함께 파기된다.
 */
export async function createPendingAttachment(
  orgId: string,
  userId: string,
  channelId: string,
  input: { fileName: string; contentType: string; size: number },
): Promise<PresignOutcome> {
  if (!storage) {
    return { status: 'unavailable' };
  }
  // 접근 판정은 전송과 같은 visibleWhere 계열이다 — 볼 수 없는 채널에 업로드 자리를 내주면
  // 바인딩 전 단계가 접근 경계 밖에서 시작된다. 판정 전용 경량 조회를 쓴다(KAN-34).
  if (!(await canAccessChannel(orgId, userId, channelId))) {
    return { status: 'notfound' };
  }
  // 삭제된 워크스페이스·사용자의 업로드를 막는다. post-check는 두지 않는다 — 이 행은 아직
  // 아무 화면에도 보이지 않고(pending), org가 그 사이 지워지면 행도 cascade로 함께 사라진다.
  await assertNotTombstoned([orgId, userId]);

  // 키에 파일명을 넣지 않는다(스키마 주석 참조). org 프리픽스는 조직 삭제 시 테넌트 단위
  // 정리의 좌표다(KAN-70) — 발급과 정리가 같은 헬퍼를 봐야 하므로 storage.ts에서 만든다.
  const key = `${attachmentKeyPrefix(orgId)}${crypto.randomUUID()}`;
  const row = await prisma.messageAttachment.create({
    data: {
      orgId,
      channelId,
      uploaderId: userId,
      key,
      fileName: input.fileName,
      contentType: input.contentType,
      size: input.size,
    },
  });

  const upload = await presignAttachmentUpload(key, input.contentType);
  // storage는 위에서 확인했으므로 여기서 null일 수 없지만, 타입을 좁히기 위한 방어다.
  if (!upload) {
    return { status: 'unavailable' };
  }
  return { status: 'ok', attachment: toAttachmentView(row), upload };
}

/**
 * 다운로드 접근 판정 + 짧은 presigned GET 발급. 못 보는 첨부는 없는 첨부와 같은 null이다.
 *
 * 접근 규칙은 둘 중 하나다.
 * ① 메시지에 바인딩된 첨부 — 그 메시지가 보이는 사람(visibleWhere)이면 볼 수 있다.
 * ② 아직 pending인 첨부 — **업로더 본인만.** 전송 직후 낙관 말풍선이 서버 확정 전에도
 *    자기 이미지를 그릴 수 있게 한다. 남에게는 바인딩 전 첨부가 존재하지 않는 것과 같다.
 *
 * inline 렌더는 안전한 이미지 타입일 때만 — 그 밖의 모든 것은 Content-Disposition:
 * attachment로 내려 브라우저가 실행 문맥으로 열지 못하게 한다(SVG 포함, attachments.ts).
 */
export async function resolveDownloadUrl(
  orgId: string,
  userId: string,
  attachmentId: string,
  forceDownload: boolean,
): Promise<string | null> {
  if (!storage) {
    return null;
  }
  const row = await prisma.messageAttachment.findFirst({
    where: {
      id: attachmentId,
      orgId,
      OR: [
        { messageId: { not: null }, channel: visibleWhere(orgId, userId) },
        { uploaderId: userId },
      ],
    },
  });
  if (!row) {
    return null;
  }
  const inline = !forceDownload && isInlineImage(row.contentType);
  return presignAttachmentDownload(row.key, row.fileName, row.contentType, inline);
}
