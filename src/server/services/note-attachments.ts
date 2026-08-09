import 'server-only';

import { prisma } from '@/server/db';
import { Prisma } from '@/server/generated/prisma/client';
import {
  attachmentKeyPrefix,
  presignAttachmentDownload,
  presignAttachmentUpload,
  storage,
} from '@/server/storage';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { orgSkeleton } from '@/server/services/skeleton';
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
 * 업로드 자리 — 아직 아무 노트도 참조하지 않는 행(pending) + presigned POST. 이미지 타입
 * 검증은 라우트의 zod(presignNoteImageSchema)가 이미 했고, 실제 강제는 POST 정책이 한다.
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
  // 스켈레톤이 먼저다 — orgId가 Organization FK라 웹훅이 아직 안 왔으면 create가 P2003으로
  // 죽는다(KAN-11). 채팅 첨부는 앞선 canAccessChannel이 Channel 행을, 따라서 Organization
  // 행을 보장해 이 문장이 필요 없지만, 노트 이미지는 **첫 문서를 저장하기도 전에** 쓰이는
  // 첫 write라 그 보장이 없다.
  //
  // userSkeleton은 부르지 않는다 — uploaderId에는 FK가 없다(NoteAttachment의 FK는 orgId
  // 하나뿐이다. KAN-71이 noteId를 참조 표로 뺀 뒤로도 그대로이고, MessageAttachment도 같다).
  // 부르면 웹훅이 언급한 적도 없는 사용자의 User 미러 행을 presign의 부수효과로 만들게 된다.
  const row = await prisma.$transaction(async (tx) => {
    await orgSkeleton(orgId, tx);
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
 * 첨부를 쓸 수 있는 조건 — 이 org의 것이고, 어느 노트든 이미 참조하고 있거나(노트는 org
 * 전체 공개이므로 = 조직에 공개된 이미지) 내가 올린 것(저장 전 에디터 미리보기용).
 *
 * 다운로드와 인용이 **하나의 where를 공유한다**(규약 10) — 볼 수 있는 이미지는 인용할 수도
 * 있어야 앞뒤가 맞고, 두 벌로 두면 한쪽만 바뀌어 갈라진다. 같은 주장을 주석으로 적어 두는
 * 것과 한 함수를 양쪽이 부르는 것의 차이다.
 */
export function usableNoteAttachmentWhere(
  orgId: string,
  userId: string,
): Prisma.NoteAttachmentWhereInput {
  return { orgId, OR: [{ refs: { some: {} } }, { uploaderId: userId }] };
}

/** 다운로드 접근 판정 + 짧은 presigned GET — 채팅과 같은 이유로 접근 판정이 먼저다. */
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
    where: { id: attachmentId, ...usableNoteAttachmentWhere(orgId, userId) },
  });
  if (!row) {
    return null;
  }
  const inline = !forceDownload && isInlineImage(row.contentType);
  return presignAttachmentDownload(row.key, row.fileName, row.contentType, inline);
}

/**
 * 이 저장이 첨부에 대해 할 일 — 판정(plan)과 적용(apply)을 나눈 이유가 KAN-73이다.
 *
 * 예전에는 하나였고, 묶을 수 없는 id가 하나라도 있으면 트랜잭션째 던졌다. 그런데 참조가
 * 사라지는 건 **정상 경로에서 일어난다** — 내가 초안을 열어 둔 사이 다른 사람이 그 이미지의
 * 마지막 참조를 놓으면 첨부 행이 지워진다(KAN-71의 참조 카운트). 그러면 그 초안은 제목까지
 * 포함해 **문서 전체가 거부되고**, 사용자에게는 어느 블록이 문제인지 보이지 않아 그 편집
 * 세션이 통째로 유실됐다.
 *
 * 그래서 **거부 대신 그 노드만 떨군다** — KAN-72가 attr에서 세운 노선을 노드 단위로 옮긴 것이고,
 * 공동 편집 경로(note-doc.ts)는 이미 그렇게 하고 있었다. 판정을 떼어 내야 호출자가 본문을
 * 쓰기 **전에** 무엇을 떨굴지 알 수 있다.
 */
export type NoteAttachmentPlan = {
  /** 본문에 남길 수 있는 첨부. 이 노트에 참조로 묶일 것들이다. */
  usable: Set<string>;
  /** 본문에서 떨궈야 하는 첨부 id — 사라졌거나, 이 사람이 이 org에서 쓸 수 없는 것. */
  dropped: string[];
  /**
   * 판정 시점에 이 노트가 이미 참조하던 것. apply가 '무엇을 끊을지'를 여기서만 고른다 —
   * 그때 다시 읽으면 **우리가 잠그지 않은 참조**까지 후보에 들어온다(같은 노트를 동시에
   * 저장하는 다른 트랜잭션이 그 사이 새 참조를 커밋할 수 있다). 잠근 것만 건드린다는 규칙이
   * 깨지면 collectUnreferenced가 잠금 없이 남의 첨부를 지우게 된다.
   */
  previous: string[];
};

/**
 * 판정하려는 첨부 행을 잠근다 — '참조가 몇 개인가'를 읽고 그에 따라 지우기 **전에**.
 *
 * 1:1 시절에는 바인딩이 같은 `NoteAttachment` 행의 UPDATE였고, 그래서 정리 쪽 DELETE가
 * 그 행에서 블록됐다가 PostgreSQL의 EPQ 재평가로 `noteId IS NULL`을 다시 보고 건너뛰었다
 * (storage-cleanup.ts가 메시지 첨부에 대해 적어 둔 그 장치). 참조가 **다른 표**로 나간
 * 지금은 바인딩이 `NoteAttachment` 행에 FK의 KEY SHARE만 걸고 새 튜플 버전을 만들지 않아
 * **EPQ가 아예 돌지 않는다** — 판정과 DELETE 사이에 커밋된 참조를 DELETE가 못 보고,
 * `ON DELETE CASCADE`가 그 산 참조까지 조용히 지운다(실측으로 재현했다).
 *
 * FOR UPDATE는 바인딩 쪽 FK 검증의 KEY SHARE와 충돌하므로 두 방향 모두 결정적이 된다:
 * 바인더가 먼저면 정리 쪽이 참조를 **읽기 전에** 블록되고(해제 후 다음 문장은 READ
 * COMMITTED의 새 스냅샷으로 그 참조를 본다), 정리 쪽이 먼저면 바인더의 판정이 0행을 보고
 * fail-closed로 거부된다(FK 위반 500이 아니라 invalidattachment).
 *
 * id 순으로 잡는 이유는 교착 회피다 — 호출자는 한 트랜잭션에서 **한 번에** 전부 넘긴다.
 */
async function lockAttachments(
  tx: Prisma.TransactionClient,
  orgId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT "id" FROM "NoteAttachment"
    WHERE "id" IN (${Prisma.join(ids)}) AND "orgId" = ${orgId}
    ORDER BY "id"
    FOR UPDATE`;
}

// NoteAttachment.refCount는 **DB 트리거**가 유지한다 (KAN-74) — 여기 코드에는 갱신 문장이
// 없다. 애플리케이션에서 다시 세는 방식은 참조 행이 cascade로 사라지는 경로(노트 삭제)를
// 못 덮어서, 한 곳이라도 빠지면 색인이 실제보다 크게 굳고 그 첨부는 스윕 후보에서 영영
// 빠진다. 트리거는 앱·cascade·raw SQL을 가리지 않으므로 부류가 닫힌다.
//
// 대신 **잠금 순서**를 지켜야 한다: 트리거의 UPDATE도 첨부 행 잠금을 잡으므로, 참조를
// 건드리기 전에 lockAttachments로 그 행들을 id 순으로 먼저 잡아 둔다. 안 그러면 cascade가
// 임의 순서로 잠가 정렬 순서로 잡는 저장과 교착할 수 있다.

/**
 * 저장 트랜잭션 안에서 **무엇을 묶을 수 있는지** 판정한다. 본문을 쓰기 전에 부른다.
 *
 * ⓪ 잠금 — 이 노트가 건드릴 첨부(새로 참조할 것 + 이미 참조 중인 것)를 **한 번에** 잠근다.
 *    나눠 잡으면 두 저장이 서로 다른 순서로 잡아 교착한다. 그래서 판정을 떼어 낸 지금도
 *    잠금은 여기 한 곳에서 전부 잡고, applyNoteAttachments는 다시 잡지 않는다.
 * ① 참조 가능 판정 — usableNoteAttachmentWhere. 다운로드 판정과 같은 where를 쓴다(규약 10).
 * ② 통과 못 한 것은 dropped로 돌려준다 — 예전에는 여기서 던졌다(NoteAttachmentPlan 주석).
 */
export async function planNoteAttachments(
  tx: Prisma.TransactionClient,
  orgId: string,
  userId: string,
  /** null이면 아직 만들어지지 않은 노트 — 기존 참조가 있을 수 없다(createNote 경로). */
  noteId: string | null,
  referencedIds: string[],
): Promise<NoteAttachmentPlan> {
  // 중복은 여기서 접는다 — 호출자의 dedupe에 기대면, 수집기가 순서 보존 같은 이유로 Set을
  // 잃는 날 같은 이미지를 두 번 넣은 문서에서 판정이 어긋난다(채팅의 쌍둥이 대조도 서비스
  // 안에서 접는다, chat.ts).
  const wanted = [...new Set(referencedIds)];
  const existing =
    noteId === null
      ? []
      : await tx.noteAttachmentRef.findMany({ where: { noteId }, select: { attachmentId: true } });
  const existingIds = existing.map((row) => row.attachmentId);
  const touched = [...new Set([...wanted, ...existingIds])].sort();
  await lockAttachments(tx, orgId, touched);

  if (wanted.length === 0) {
    return { usable: new Set(), dropped: [], previous: existingIds };
  }
  const rows = await tx.noteAttachment.findMany({
    where: { id: { in: wanted }, ...usableNoteAttachmentWhere(orgId, userId) },
    select: { id: true },
  });
  const usable = new Set(rows.map((row) => row.id));
  return { usable, dropped: wanted.filter((id) => !usable.has(id)), previous: existingIds };
}

/**
 * 판정한 대로 이 노트의 참조를 본문과 맞춘다. **본문을 쓴 뒤** 같은 트랜잭션에서 부른다.
 *
 * ① 참조 갱신 — 추가는 skipDuplicates, 본문에서 빠진 것은 삭제.
 * ② 정리 — 그 결과 **참조가 0이 된** 첨부만 행을 지우며 키를 outbox(KAN-70)에 적는다.
 *    cascade가 아니라 여기서 지우는 이유: 행만 사라지면 '지울 좌표'도 함께 사라진다.
 *    참조가 남아 있으면 지우지 않는다 — 그게 KAN-71이 고친 데이터 유실의 핵심이다.
 *    단 한 번도 참조된 적 없는 pending은 여기 걸리지 않는다(애초에 이 노트의 참조가 아니다).
 *
 * 잠금은 planNoteAttachments가 이미 전부 잡았다 — 그 짝으로만 부른다.
 */
export async function applyNoteAttachments(
  tx: Prisma.TransactionClient,
  orgId: string,
  noteId: string,
  plan: NoteAttachmentPlan,
): Promise<void> {
  const keep = [...plan.usable];
  if (keep.length > 0) {
    await tx.noteAttachmentRef.createMany({
      data: keep.map((attachmentId) => ({ noteId, attachmentId })),
      skipDuplicates: true,
    });
  }

  // 이 노트가 더는 참조하지 않는 것들 — 그 첨부가 다른 곳에서도 안 쓰이면 그때 지운다.
  const unlinked = plan.previous.filter((id) => !plan.usable.has(id));
  if (unlinked.length === 0) return;

  await tx.noteAttachmentRef.deleteMany({ where: { noteId, attachmentId: { in: unlinked } } });
  await collectUnreferenced(tx, orgId, unlinked);
}

/**
 * 이 노트가 참조하는 첨부를 읽고 **미리 잠근다** — 노트를 지우기 전에 부른다.
 *
 * 노트 삭제는 참조 행을 cascade로 없애고, 그때 트리거가 첨부 행을 UPDATE하며 잠근다.
 * cascade의 순서는 우리가 정하지 못하므로, 먼저 id 순으로 전부 잡아 두어야 정렬 순서로
 * 잡는 저장 경로와 교착하지 않는다. 반환값은 그대로 collectUnreferenced에 넘긴다 —
 * 노트가 사라진 뒤에는 '무엇이 고아가 됐는지' 알 방법이 없다.
 */
export async function lockNoteAttachments(
  tx: Prisma.TransactionClient,
  orgId: string,
  noteId: string,
): Promise<string[]> {
  const rows = await tx.noteAttachmentRef.findMany({
    where: { noteId },
    select: { attachmentId: true },
  });
  const ids = [...new Set(rows.map((row) => row.attachmentId))].sort();
  await lockAttachments(tx, orgId, ids);
  return ids;
}

/**
 * 참조가 0이 된 첨부의 행을 지우고 키를 outbox에 적는다 — 참조 삭제의 유일한 뒷정리 지점
 * (노트 저장·노트 삭제가 공유한다). 여기서 `refs: { none: {} }`가 곧 참조 카운트 0이다.
 * 판정 전에 잠그는 이유는 lockAttachments에 적었다(재잠금은 무해하므로 저장 경로가 이미
 * 잡아 둔 경우에도 그대로 부른다).
 */
export async function collectUnreferenced(
  tx: Prisma.TransactionClient,
  orgId: string,
  candidateIds: string[],
): Promise<void> {
  if (candidateIds.length === 0) return;
  const candidates = [...new Set(candidateIds)].sort();
  await lockAttachments(tx, orgId, candidates);
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
