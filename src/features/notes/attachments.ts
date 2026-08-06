import type { JSONContent } from '@tiptap/core';
import { isInlineImage, MAX_ATTACHMENT_BYTES } from '@/lib/attachments';

// 노트 본문 이미지의 공용 규칙 (KAN-38). 별도 모듈인 이유: content.ts가 validation.ts를
// import하므로(파싱 시 검증), validation이 쓸 상수를 content에 두면 순환이 된다.

/** 본문 이미지 src의 유일한 형태 — 우리 라우트. 스토리지 URL·외부 URL은 저장되지 않는다. */
export const NOTE_ATTACHMENT_ROUTE = '/api/notes/attachments/';

/** src 화이트리스트 정규식 — validation.ts의 zod와 저장 전 검사가 같은 것을 본다. */
export const NOTE_ATTACHMENT_SRC_RE = /^\/api\/notes\/attachments\/[a-z0-9]{1,64}$/;

export function noteAttachmentSrc(id: string): string {
  return `${NOTE_ATTACHMENT_ROUTE}${id}`;
}

/**
 * 본문이 참조하는 첨부 id 목록 — 저장 트랜잭션의 바인딩·미참조 정리의 근거
 * (services/note-attachments.ts). 반복 순회라 깊은 doc에도 스택이 안전하다.
 */
export function collectNoteAttachmentIds(doc: JSONContent): string[] {
  const ids = new Set<string>();
  const stack: JSONContent[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const src = node.type === 'image' ? node.attrs?.src : null;
    if (typeof src === 'string' && NOTE_ATTACHMENT_SRC_RE.test(src)) {
      ids.add(src.slice(NOTE_ATTACHMENT_ROUTE.length));
    }
    for (const child of node.content ?? []) stack.push(child);
  }
  return [...ids];
}

export type UploadImageResult = { ok: true; src: string } | { ok: false; error: string };

/**
 * 브라우저에서 이미지를 스토리지에 직접 올리고 본문에 넣을 src를 돌려준다 —
 * presign(우리 라우트) → 스토리지에 POST(정책이 크기·타입을 강제) 순서. 서버를
 * 거치지 않는 이유와 POST 정책의 근거는 KAN-35(src/server/storage.ts).
 */
export async function uploadNoteImage(file: File): Promise<UploadImageResult> {
  if (!isInlineImage(file.type)) {
    return { ok: false, error: '이미지 파일(PNG·JPEG·GIF·WebP)만 넣을 수 있어요.' };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: '10MB 이하 이미지만 넣을 수 있어요.' };
  }
  const presign = await fetch(NOTE_ATTACHMENT_ROUTE.replace(/\/$/, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }),
  });
  if (!presign.ok) {
    const body = (await presign.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? '이미지 업로드를 준비하지 못했어요.' };
  }
  const { attachment, upload } = (await presign.json()) as {
    attachment: { id: string };
    upload: { url: string; fields: Record<string, string> };
  };

  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
  // 'file' 필드는 정책 필드들 뒤에 와야 한다 — S3 POST 규약.
  form.append('file', file);
  const uploaded = await fetch(upload.url, { method: 'POST', body: form });
  if (!uploaded.ok) {
    return { ok: false, error: '이미지 업로드에 실패했어요. 잠시 후 다시 시도해주세요.' };
  }
  return { ok: true, src: noteAttachmentSrc(attachment.id) };
}
