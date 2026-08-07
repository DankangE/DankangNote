import 'server-only';

import { prisma } from '@/server/db';
import type { Prisma } from '@/server/generated/prisma/client';
import {
  attachmentKeyPrefix,
  presignAttachmentDownload,
  presignAttachmentUpload,
  storage,
} from '@/server/storage';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { orgSkeleton, userSkeleton } from '@/server/services/skeleton';
import { isInlineImage } from '@/lib/attachments';
import type { UploadTicket } from '@/server/storage';

// 노트 본문 이미지 (KAN-38) — 채팅 첨부(attachments.ts, KAN-35)와 같은 수명 구조를
// 노트에 맞게 옮긴 것. 접근 경계가 다르다: 채팅은 채널 가시성(visibleWhere), 노트는
// org 전체 공개라 'org 멤버인가'가 전부다. 바인딩은 노트 저장 트랜잭션의 일부다
// (syncNoteAttachments — 본문 참조와 행의 일치가 저장과 원자적이어야 하므로).

export type NotePresignOutcome =
  | { status: 'ok'; attachment: { id: string }; upload: UploadTicket }
  | { status: 'unavailable' };

/**
 * 업로드 자리 — pending 행(noteId null) + presigned POST. 이미지 타입 검증은 라우트의
 * zod(presignNoteImageSchema)가 이미 했고, 실제 강제는 POST 정책이 한다.
 */
export async function createPendingNoteAttachment(
  orgId: string,
  userId: string,
  input: { fileName: string; contentType: string; size: number },
): Promise<NotePresignOutcome> {
  if (!storage) {
    return { status: 'unavailable' };
  }
  await assertNotTombstoned([orgId, userId]);

  // 채팅과 같은 org 프리픽스 — 조직 삭제의 프리픽스 정리(KAN-70)가 노트 이미지까지 덮는다.
  const key = `${attachmentKeyPrefix(orgId)}${crypto.randomUUID()}`;
  // 스켈레톤이 먼저다 — orgId·uploaderId가 Clerk 미러 FK라 웹훅이 아직 안 왔으면 create가
  // P2003으로 죽는다(KAN-11). 채팅 첨부는 앞선 canAccessChannel이 Channel 행을, 따라서
  // Organization 행을 보장해 이 문장이 필요 없지만, 노트 이미지는 **첫 문서를 저장하기도
  // 전에** 쓰이는 첫 write라 그 보장이 없다.
  const row = await prisma.$transaction(async (tx) => {
    await orgSkeleton(orgId, tx);
    await userSkeleton(userId, tx);
    return tx.noteAttachment.create({
      data: {
        orgId,
        uploaderId: userId,
        key,
        fileName: input.fileName,
        contentType: input.contentType,
        size: input.size,
      },
    });
  });
  // 스켈레톤이 삭제된 org·user를 되살렸을 수 있다 — 되살아났으면 이 행째 정리하고 throw
  // 한다(createNote와 같은 pre/post 이중 가드).
  await assertNotTombstoned([orgId, userId], async () => {
    await prisma.noteAttachment.deleteMany({ where: { id: row.id } });
  });
  const upload = await presignAttachmentUpload(key, input.contentType);
  if (!upload) {
    return { status: 'unavailable' };
  }
  return { status: 'ok', attachment: { id: row.id }, upload };
}

/**
 * 다운로드 접근 판정 + 짧은 presigned GET. 노트는 org 전체 공개라 어느 노트든 참조하는
 * 첨부는 org 멤버 누구나, 아직 아무 데서도 안 쓰이는 것(pending)은 업로더 본인만(저장 전
 * 에디터 미리보기용) — 채팅과 같은 이유다. 참조 판정(syncNoteAttachments ①)이 이 규칙을
 * 그대로 따른다: 볼 수 있는 이미지는 인용할 수도 있어야 앞뒤가 맞는다.
 */
export async function resolveNoteAttachmentUrl(
  orgId: string,
  userId: string,
  attachmentId: string,
  forceDownload: boolean,
): Promise<string | null> {
  if (!storage) {
    return null;
  }
  const row = await prisma.noteAttachment.findFirst({
    where: {
      id: attachmentId,
      orgId,
      OR: [{ refs: { some: {} } }, { uploaderId: userId }],
    },
  });
  if (!row) {
    return null;
  }
  const inline = !forceDownload && isInlineImage(row.contentType);
  return presignAttachmentDownload(row.key, row.fileName, row.contentType, inline);
}

/** 본문 참조와 첨부 행을 못 맞춘 저장 — 액션이 판별 에러로 변환한다. */
export class InvalidNoteAttachmentError extends Error {
  constructor() {
    super('본문이 참조하는 이미지가 이 노트에 바인딩될 수 없다');
  }
}

/**
 * 저장 트랜잭션 안에서 본문의 첨부 참조와 참조 행을 일치시킨다.
 *
 * ① 참조 가능 판정 — 이 org의 첨부이고, **이미 어딘가에서 쓰이고 있거나(=조직에 공개된
 *    이미지) 내가 올린 것**이어야 한다. 다운로드 판정(resolveNoteAttachmentUrl)과 같은
 *    규칙이다 — 볼 수 있는 이미지는 인용할 수도 있어야 앞뒤가 맞는다.
 * ② 검증 — 참조 전부가 통과했는지 센다. 모자라면 남의 org 또는 남의 저장 전 pending id를
 *    실어 온 것이므로 throw로 트랜잭션째 거부한다(fail-closed, KAN-35의 count 불일치 롤백).
 * ③ 참조 갱신 — 이 노트의 참조를 본문과 맞춘다(추가는 skipDuplicates, 빠진 것은 삭제).
 * ④ 정리 — 그 결과 **참조가 0이 된** 첨부만 행을 지우며 키를 outbox(KAN-70)에 적는다.
 *    cascade가 아니라 여기서 지우는 이유: 행만 사라지면 '지울 좌표'도 함께 사라진다.
 *    참조가 남아 있으면 지우지 않는다 — 그게 KAN-71이 고친 데이터 유실의 핵심이다.
 *    단 한 번도 참조된 적 없는 pending은 여기 걸리지 않는다(애초에 이 노트의 참조가 아니다).
 */
export async function syncNoteAttachments(
  tx: Prisma.TransactionClient,
  orgId: string,
  userId: string,
  noteId: string,
  referencedIds: string[],
): Promise<void> {
  if (referencedIds.length > 0) {
    const usable = await tx.noteAttachment.findMany({
      where: {
        id: { in: referencedIds },
        orgId,
        OR: [{ refs: { some: {} } }, { uploaderId: userId }],
      },
      select: { id: true },
    });
    if (usable.length !== referencedIds.length) {
      throw new InvalidNoteAttachmentError();
    }
    await tx.noteAttachmentRef.createMany({
      data: usable.map((row) => ({ noteId, attachmentId: row.id })),
      skipDuplicates: true,
    });
  }

  // 이 노트가 더는 참조하지 않는 것들 — 그 첨부가 다른 곳에서도 안 쓰이면 그때 지운다.
  const dropped = await tx.noteAttachmentRef.findMany({
    where: { noteId, attachmentId: { notIn: referencedIds } },
    select: { attachmentId: true },
  });
  if (dropped.length === 0) return;

  await tx.noteAttachmentRef.deleteMany({
    where: { noteId, attachmentId: { in: dropped.map((row) => row.attachmentId) } },
  });
  await collectUnreferenced(tx, orgId, dropped.map((row) => row.attachmentId));
}

/**
 * 참조가 0이 된 첨부의 행을 지우고 키를 outbox에 적는다 — 참조 삭제의 유일한 뒷정리 지점
 * (노트 저장·노트 삭제가 공유한다). 여기서 `refs: { none: {} }`가 곧 참조 카운트 0이다.
 */
export async function collectUnreferenced(
  tx: Prisma.TransactionClient,
  orgId: string,
  candidateIds: string[],
): Promise<void> {
  if (candidateIds.length === 0) return;
  const orphaned = await tx.noteAttachment.findMany({
    where: { id: { in: candidateIds }, orgId, refs: { none: {} } },
    select: { id: true, key: true },
  });
  if (orphaned.length === 0) return;
  await tx.storageCleanup.createMany({
    data: orphaned.map((row) => ({ kind: 'key', target: row.key })),
    skipDuplicates: true,
  });
  await tx.noteAttachment.deleteMany({
    where: { id: { in: orphaned.map((row) => row.id) }, orgId },
  });
}
