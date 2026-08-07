import { FileText } from 'lucide-react';
import { isInlineImage } from '@/lib/attachments';
import { attachmentUrl, formatBytes } from '@/features/chat/attachments';
import type { AttachmentView } from '@/features/chat/types';

// 메시지에 붙은 첨부 렌더 (KAN-35). 안전한 이미지 타입은 인라인으로, 나머지는 다운로드
// 칩으로 — 이 분기는 attachments.ts의 isInlineImage 하나가 정의하고, 서버의 다운로드
// presign도 같은 판정을 쓴다(칩인 것은 반드시 attachment disposition으로 내려온다).
//
// src·href가 전부 우리 라우트(/api/chat/attachments/[id])다: 매 요청 접근 판정을 거치고,
// 낙관 말풍선 단계(pending 첨부)에서도 업로더 본인에게는 이미 서빙되므로 확정 전후의
// 주소가 같다 — 서버 확정본으로 교체돼도 이미지가 다시 로드되지 않는다.
export function MessageAttachments({ attachments }: { attachments: AttachmentView[] }) {
  const images = attachments.filter((attachment) => isInlineImage(attachment.contentType));
  const files = attachments.filter((attachment) => !isInlineImage(attachment.contentType));

  return (
    <div className="mt-1 flex flex-col items-start gap-1.5">
      {images.map((attachment) => (
        <a
          key={attachment.id}
          href={attachmentUrl(attachment.id)}
          target="_blank"
          rel="noreferrer"
          className="block max-w-xs overflow-hidden rounded-lg border"
          aria-label={`${attachment.fileName} 원본 보기`}
        >
          {/* next/image가 아닌 이유: src가 302로 60초짜리 presigned URL에 닿는 구조라
              최적화 프록시 캐시가 만료 주소를 들고 남는다. 원본을 그대로 쓰되 lazy로 미룬다. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachmentUrl(attachment.id)}
            alt={attachment.fileName}
            loading="lazy"
            className="max-h-64 w-auto object-contain"
          />
        </a>
      ))}
      {files.map((attachment) => (
        <a
          key={attachment.id}
          href={attachmentUrl(attachment.id, true)}
          className="inline-flex max-w-xs items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-sm hover:bg-accent"
        >
          <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{attachment.fileName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatBytes(attachment.size)}
          </span>
        </a>
      ))}
    </div>
  );
}
