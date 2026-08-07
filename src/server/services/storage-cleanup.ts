import 'server-only';

import { prisma } from '@/server/db';
import {
  deleteObject,
  deleteObjectsUnderPrefix,
  storage,
  UPLOAD_TTL_SECONDS,
} from '@/server/storage';

// 스토리지 정리 (KAN-70) — 첨부 행의 수명과 스토리지 오브젝트의 수명이 다른 데서 생기는
// 고아를 걷는다. '지울 좌표'는 삭제 트랜잭션이 StorageCleanup(outbox)에 적어 두고(조직
// 삭제·채널 삭제), 전송 없이 버려진 pending은 여기의 스윕이 행을 걷으며 적는다. 실제
// 스토리지 호출은 processStorageCleanup 하나가 하고, 실패하면 행이 남아 다음 실행이
// 다시 시도한다.

/**
 * 전송 없이 버려진 pending을 고아로 확정하는 나이. 컴포저 세션이 이보다 오래 살지 않고,
 * presign(10분)은 한참 전에 죽었다 — 바인딩 경합 시에도 전송 쪽 count 검증이 롤백으로
 * 답하므로(chat.createMessage) 산 첨부를 지울 일은 없다.
 */
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * outbox 행을 만든 지 이만큼 지나야 처리한다. presign TTL보다 길어야 하는 것이 핵심이다:
 * 채널 삭제로 enqueue된 키의 업로드가 아직 진행 중일 수 있다 — 지금 지우면 그 뒤에
 * 업로드가 완료돼 오브젝트가 되살아나고, 행은 이미 처리돼 사라져 영영 고아가 된다.
 * TTL이 지나면 새 업로드는 **시작**될 수 없다. 만료 직전에 시작해 유예를 넘겨 완료되는
 * 업로드는 정책 만료의 검증 시점(구현별 세부)에 따라 이론상 남을 수 있는데, 어긋나는
 * 방향이 고아 잔존뿐이라(산 데이터 삭제 아님) 유예를 늘리는 것으로만 대응한다.
 */
export const PROCESS_GRACE_MS = (UPLOAD_TTL_SECONDS + 5 * 60) * 1000;

/**
 * 한 실행이 집는 outbox 행 수 — cron 호출 하나의 실행 시간을 예측 가능하게 묶는다
 * (서버리스 함수의 실행 시간 상한 안). 유입이 이보다 크면 백로그는 다음 실행으로 밀린다 —
 * 지워야 할 것이 밀리는 것이므로, 밀림이 관측되면 cron을 더 자주 돌리는 쪽으로 푼다.
 */
const PROCESS_BATCH_SIZE = 200;

/**
 * 전송 없이 버려진 pending 행을 걷어 키를 outbox로 옮긴다. 반환은 옮긴 행 수.
 *
 * DELETE … RETURNING 한 문장이라 '지운 행'과 '적을 키'가 원자로 일치한다 — findMany 후
 * deleteMany로 가르면 그 사이에 바인딩된 행이 조회에는 잡히고 삭제 조건(messageId null)
 * 에서는 빠져, 산 첨부의 키가 outbox에 들어간다.
 *
 * 배치 상한(LIMIT)이 있는 이유: 무제한 DELETE는 첫 도입 시점의 누적 백로그에서 interactive
 * 트랜잭션 타임아웃에 걸려 통째로 롤백되기를 반복한다 — 상한을 두면 실행마다 앞으로 간다.
 * 바깥 WHERE에 messageId IS NULL을 반복하는 것은 장식이 아니다: 동시에 바인딩된 행을
 * DELETE의 재평가(EPQ)가 이 조건으로 건너뛴다 — 서브쿼리 id 목록은 문장 스냅샷이라
 * 그것만으로는 못 거른다.
 */
const SWEEP_BATCH_SIZE = 1000;

export async function sweepAbandonedPending(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PENDING_MAX_AGE_MS);
  return prisma.$transaction(async (tx) => {
    const removed = await tx.$queryRaw<{ key: string }[]>`
      DELETE FROM "MessageAttachment"
      WHERE "messageId" IS NULL AND "id" IN (
        SELECT "id" FROM "MessageAttachment"
        WHERE "messageId" IS NULL AND "createdAt" < ${cutoff}
        LIMIT ${SWEEP_BATCH_SIZE}
      )
      RETURNING "key"`;
    // 노트 이미지(KAN-38)도 같은 규칙으로 걷는다 — 저장 없이 버려진 것. KAN-71 이후
    // 'pending'은 컬럼이 아니라 **참조 0**이다(NoteAttachmentRef 행이 없다). 노트 저장·삭제
    // 경로는 참조가 0이 되는 순간 스스로 정리하므로, 여기 걸리는 건 presign만 받고 저장에
    // 도달하지 못한 업로드다.
    const removedNotes = await tx.$queryRaw<{ key: string }[]>`
      DELETE FROM "NoteAttachment"
      WHERE "id" IN (
        SELECT a."id" FROM "NoteAttachment" a
        WHERE a."createdAt" < ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM "NoteAttachmentRef" r WHERE r."attachmentId" = a."id")
        LIMIT ${SWEEP_BATCH_SIZE}
      )
      RETURNING "key"`;
    const keys = [...removed, ...removedNotes];
    if (keys.length > 0) {
      await tx.storageCleanup.createMany({
        data: keys.map((row) => ({ kind: 'key', target: row.key })),
        skipDuplicates: true,
      });
    }
    return keys.length;
  });
}

export interface ProcessResult {
  /** 스토리지에서 지워져 outbox에서 내려간 행 수. */
  processed: number;
  /** 실패해 attempts만 올리고 남긴 행 수. */
  failed: number;
}

/**
 * outbox를 실제 스토리지 삭제로 옮긴다. 유예(PROCESS_GRACE_MS)가 지난 행만 집고,
 * attempts 오름차순이라 포이즌 행이 새 작업을 막지 않는다.
 *
 * 동시 실행(겹친 cron)은 안전하되 낭비다 — 스토리지 삭제는 멱등이고 행 삭제·갱신은
 * count 기반이라 서로를 깨뜨리지 않는다. 잠금(SKIP LOCKED)은 그 낭비가 실측될 때 단다.
 */
export async function processStorageCleanup(now: Date = new Date()): Promise<ProcessResult> {
  // 스토리지가 꺼진 환경이면 지울 수단이 없다 — 행은 남겨 두고(켜지면 그때 지운다) 끝낸다.
  if (!storage) {
    return { processed: 0, failed: 0 };
  }
  const cutoff = new Date(now.getTime() - PROCESS_GRACE_MS);
  const tasks = await prisma.storageCleanup.findMany({
    where: { createdAt: { lt: cutoff } },
    orderBy: [{ attempts: 'asc' }, { createdAt: 'asc' }],
    take: PROCESS_BATCH_SIZE,
  });

  let processed = 0;
  let failed = 0;
  for (const task of tasks) {
    try {
      if (task.kind === 'prefix') {
        const finished = await deleteObjectsUnderPrefix(task.target);
        if (!finished) {
          // 실행 상한에 걸린 미완 — 실패가 아니다. 행을 그대로 남겨 다음 실행이 이어서
          // 지운다(이미 지운 몫은 사라졌으므로 진행은 앞으로만 간다).
          continue;
        }
      } else if (task.kind === 'key') {
        await deleteObject(task.target);
      } else {
        // 알 수 없는 kind를 key로 뭉개면 안 된다 — 프리픽스 좌표를 키 하나로 지운 척하고
        // 행을 내려, 그 아래 오브젝트 전부가 복구 근거 없이 남는다. fail-closed로 남긴다.
        throw new Error(`알 수 없는 kind: ${task.kind}`);
      }
      await prisma.storageCleanup.deleteMany({ where: { id: task.id } });
      processed += 1;
    } catch (error) {
      failed += 1;
      // 행이 곧 재시도 예약이다. 에러 문자열은 잘라 담는다 — 진단용이지 로그 저장소가 아니다.
      await prisma.storageCleanup.updateMany({
        where: { id: task.id },
        data: { attempts: { increment: 1 }, lastError: String(error).slice(0, 500) },
      });
    }
  }
  return { processed, failed };
}
