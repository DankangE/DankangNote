// 스윕 ↔ 저장 경합 (KAN-71 자체 리뷰). 별도 파일인 이유는 시드가 10만 행이라서다 —
// 스윕 문장이 **스캔하는 동안** 저장이 들어와야 재현되고, 그 창은 훑을 행 수에 비례한다.
//
// 이 테스트가 없으면 다음 회귀가 그대로 통과한다: 잠금(FOR UPDATE SKIP LOCKED)을 판정과
// **같은 문장**에 붙이는 것. 계획이 `Limit → LockRows → 안티조인`이라 NOT EXISTS는 문장
// 스냅샷으로 판정되고 잠금은 그 뒤에 걸리므로, 그 사이 커밋한 참조를 못 보고 지운다.
// 실측(수정 전 형태): `저장성공=true 첨부남음=0 참조남음=0` — 저장은 성공했다고 알리고
// 첨부와 참조는 사라진다. 규약 26.
import { beforeEach, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { ORG_A, USER_OWNER, resetDatabase, seedTenants } from '../../../test/db';
import { sweepAbandonedPending } from './storage-cleanup';
import { syncNoteAttachments } from './note-attachments';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
});

const OLD = () => new Date(Date.now() - 30 * 60 * 60 * 1000);

it('실제 스윕이 동시 저장의 참조를 지우지 않는다 (스캔 창 재현)', async () => {
  const note = await prisma.note.create({
    data: { orgId: ORG_A, authorId: USER_OWNER, title: '초안' },
  });

  // 참조가 있어 안티조인이 버릴 오래된 첨부 10만건 — 스윕의 스캔 구간을 만든다.
  await prisma.$executeRaw`
    INSERT INTO "NoteAttachment"("id","orgId","uploaderId","key","fileName","contentType","size","createdAt")
    SELECT 'a'||lpad(g::text,8,'0'), ${ORG_A}, ${USER_OWNER}, 'k'||g, 'f.png', 'image/png', 10, ${OLD()}
    FROM generate_series(1,100000) g`;
  await prisma.$executeRaw`
    INSERT INTO "NoteAttachmentRef"("noteId","attachmentId")
    SELECT ${note.id}, 'a'||lpad(g::text,8,'0') FROM generate_series(1,100000) g`;

  // 표적: id 순 마지막, 참조 없음, 오래됨 → 스캔 끝에서야 잠금에 도달한다.
  const target = await prisma.noteAttachment.create({
    data: {
      id: 'zzz-target',
      orgId: ORG_A,
      uploaderId: USER_OWNER,
      key: 'org/a/att/target',
      fileName: 't.png',
      contentType: 'image/png',
      size: 10,
      createdAt: OLD(),
    },
  });
  const other = await prisma.note.create({
    data: { orgId: ORG_A, authorId: USER_OWNER, title: '저장할 노트' },
  });

  // 스윕과 저장을 겹친다 — 저장은 스윕 문장이 스캔 중일 때 들어간다.
  const sweeping = sweepAbandonedPending();
  await new Promise((resolve) => setTimeout(resolve, 20));
  let saved = true;
  try {
    await prisma.$transaction(
      async (tx) => {
        await syncNoteAttachments(tx, ORG_A, USER_OWNER, other.id, [target.id]);
      },
      { timeout: 20000 },
    );
  } catch {
    saved = false; // fail-closed로 거부됨 — 허용되는 결말이다
  }
  await sweeping;

  const attachmentLeft = await prisma.noteAttachment.count({ where: { id: target.id } });
  const refLeft = await prisma.noteAttachmentRef.count({ where: { attachmentId: target.id } });

  // 파괴란: 저장이 성공했다고 알렸는데 그 첨부가 사라진 것. 둘 중 하나여야 한다 —
  // 저장이 이겨서 둘 다 살아 있거나, 스윕이 이겨서 저장이 거부되고 참조도 안 생겼거나.
  if (saved) {
    expect(attachmentLeft).toBe(1);
    expect(refLeft).toBe(1);
  } else {
    expect(refLeft).toBe(0);
  }
}, 120000);
