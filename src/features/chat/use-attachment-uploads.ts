'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isInlineImage,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '@/features/chat/attachments';
import type { AttachmentView } from '@/features/chat/types';

// 컴포저의 첨부 준비 상태 (KAN-35). 파일을 고르면 presign → 스토리지 직접 업로드까지를
// 여기서 끝내 두고, 전송은 준비된 attachment id만 싣는다 — 전송 버튼을 누르는 순간에는
// 더 기다릴 것이 없다.

export type StagedAttachment = {
  /** 화면 목록의 키. 서버 id는 presign 응답이 와야 생기므로 따로 둔다. */
  localId: string;
  fileName: string;
  contentType: string;
  size: number;
  /** 이미지면 선택 즉시 보여줄 로컬 미리보기(objectURL). 해제 책임도 이 훅에 있다. */
  previewUrl: string | null;
  status: 'uploading' | 'ready' | 'error';
  /** presign이 만든 pending 행의 id — 전송 시 바인딩 대상. */
  attachmentId?: string;
  error?: string;
};

const GENERIC_UPLOAD_ERROR = '업로드에 실패했어요. 파일을 지우고 다시 시도해주세요.';

async function uploadOne(
  channelId: string,
  file: File,
): Promise<{ attachmentId: string } | { error: string }> {
  // 브라우저가 타입을 모르는 파일(확장자 없는 파일 등)은 octet-stream으로 — 다운로드 칩으로
  // 다뤄지고, 다운로드 응답도 attachment로 강제되므로 안전한 기본값이다.
  const contentType = file.type || 'application/octet-stream';
  const presign = await fetch('/api/chat/attachments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId, fileName: file.name, contentType, size: file.size }),
  });
  if (!presign.ok) {
    if (presign.status === 503) {
      return { error: '첨부 스토리지가 설정되지 않은 환경이에요.' };
    }
    // 400은 서버 zod가 만든 문구를 그대로 보여준다(파일 이름·형식·크기 안내).
    if (presign.status === 400) {
      const data = (await presign.json().catch(() => null)) as { error?: string } | null;
      return { error: data?.error ?? GENERIC_UPLOAD_ERROR };
    }
    return { error: GENERIC_UPLOAD_ERROR };
  }
  const ticket = (await presign.json()) as {
    attachment: AttachmentView;
    upload: { url: string; fields: Record<string, string> };
  };

  // 스토리지 직접 업로드(presigned POST). fields를 먼저, 파일을 마지막에 — S3 POST 정책은
  // file 파트 이후의 필드를 무시한다.
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.upload.fields)) {
    form.append(name, value);
  }
  form.append('file', file);
  const stored = await fetch(ticket.upload.url, { method: 'POST', body: form });
  if (!stored.ok) {
    // 정책 위반(크기·타입)이 여기로 온다 — 스토리지가 최종 관문이라는 설계 그대로다.
    return { error: GENERIC_UPLOAD_ERROR };
  }
  return { attachmentId: ticket.attachment.id };
}

export function useAttachmentUploads(channelId: string) {
  const [items, setItems] = useState<StagedAttachment[]>([]);
  /** 목록 밖 안내(개수 초과 등). 다음 선택에서 지워진다. */
  const [notice, setNotice] = useState<string | null>(null);

  // 언마운트(채널 이동·스레드 닫기) 시 미리보기 objectURL을 해제한다. items를 ref로 미러링해
  // 클린업이 마지막 상태를 보게 한다 — 의존성으로 걸면 항목이 바뀔 때마다 해제·재생성된다.
  // 미러링은 effect에서 한다(렌더 중 ref 쓰기 금지 — ChatRoom의 messagesRef와 같은 패턴).
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(
    () => () => {
      for (const item of itemsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    },
    [],
  );

  const patch = useCallback((localId: string, update: Partial<StagedAttachment>) => {
    setItems((prev) =>
      prev.map((item) => (item.localId === localId ? { ...item, ...update } : item)),
    );
  }, []);

  const stage = useCallback(
    (files: readonly File[]) => {
      setNotice(null);
      const room = MAX_ATTACHMENTS_PER_MESSAGE - itemsRef.current.length;
      if (files.length > room) {
        setNotice(`첨부는 한 번에 ${MAX_ATTACHMENTS_PER_MESSAGE}개까지예요.`);
      }
      for (const file of files.slice(0, Math.max(room, 0))) {
        const localId = crypto.randomUUID();
        const contentType = file.type || 'application/octet-stream';
        const entry: StagedAttachment = {
          localId,
          fileName: file.name,
          contentType,
          size: file.size,
          previewUrl: isInlineImage(contentType) ? URL.createObjectURL(file) : null,
          status: 'uploading',
        };
        // 크기 초과는 올려 보지도 않는다 — 스토리지 정책이 어차피 거부한다(서버 강제는 그쪽).
        if (file.size > MAX_ATTACHMENT_BYTES) {
          entry.status = 'error';
          entry.error = '파일은 10MB 이하여야 해요.';
          setItems((prev) => [...prev, entry]);
          continue;
        }
        setItems((prev) => [...prev, entry]);
        void uploadOne(channelId, file)
          .then((result) => {
            if ('error' in result) {
              patch(localId, { status: 'error', error: result.error });
            } else {
              patch(localId, { status: 'ready', attachmentId: result.attachmentId });
            }
          })
          .catch(() => {
            patch(localId, { status: 'error', error: GENERIC_UPLOAD_ERROR });
          });
      }
    },
    [channelId, patch],
  );

  const remove = useCallback((localId: string) => {
    setItems((prev) => {
      const target = prev.find((item) => item.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      // 업로드가 끝난 것을 지우면 pending 행·오브젝트가 남는다 — 채널·조직 수명과 함께
      // 정리되는 알려진 잔재다(스키마 주석). 전송 취소가 서버 왕복을 요구하지 않게 한다.
      return prev.filter((item) => item.localId !== localId);
    });
  }, []);

  /** 전송이 확정된 뒤 호출 — 방금 보낸 것들을 비운다. */
  const clear = useCallback(() => {
    setItems((prev) => {
      for (const item of prev) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
    setNotice(null);
  }, []);

  const ready: AttachmentView[] = items
    .filter(
      (item): item is StagedAttachment & { attachmentId: string } =>
        item.status === 'ready' && !!item.attachmentId,
    )
    .map((item) => ({
      id: item.attachmentId,
      fileName: item.fileName,
      contentType: item.contentType,
      size: item.size,
    }));

  return {
    items,
    notice,
    stage,
    remove,
    clear,
    /** 전송에 실을 준비가 끝난 첨부 뷰(실제 id 포함) — 낙관 말풍선에도 그대로 쓴다. */
    ready,
    /** 하나라도 올라가는 중이면 전송을 잠근다 — 절반짜리 메시지를 만들지 않는다. */
    uploading: items.some((item) => item.status === 'uploading'),
  };
}
