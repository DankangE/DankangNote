import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  ORG_A,
  ORG_B,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedTenants,
} from '../../../test/db';
import { createNote, deleteNote, updateNote } from './notes';
import {
  createPendingNoteAttachment,
  resolveNoteAttachmentUrl,
  syncNoteAttachments,
} from './note-attachments';
import { sweepAbandonedPending } from './storage-cleanup';

const owner = { userId: USER_OWNER, isAdmin: false };

const IMAGE = { fileName: 'a.png', contentType: 'image/png', size: 10 };
// presigned URL에서 '무엇으로 내려보내는가'를 보는 유일한 자리. 그냥 'attachment'를 찾으면
// **버킷 이름**(dankangnote-attachments / test-attachments)에 걸려 무엇을 서명하든 통과하는
// 공허한 어서션이 된다 — forcePathStyle이라 버킷이 항상 경로에 있다 (KAN-72).
const DISPOSITION = 'response-content-disposition=';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
});

async function noteInA(): Promise<string> {
  const note = await prisma.note.create({
    data: { orgId: ORG_A, authorId: USER_OWNER, title: '문서' },
  });
  return note.id;
}

/**
 * 실제 presign 경로로 pending 행을 만든다 — 서명은 오프라인이라 스토리지 없이 돈다
 * (setup-env.ts의 더미 env). 서비스를 우회해 prisma.create로 심으면 스켈레톤·tombstone
 * 가드가 통째로 검증 밖으로 빠진다.
 */
async function pending(orgId: string, uploaderId: string): Promise<{ id: string; key: string }> {
  const outcome = await createPendingNoteAttachment(orgId, uploaderId, IMAGE);
  if (outcome.status !== 'ok') throw new Error(`presign 실패: ${outcome.status}`);
  const row = await prisma.noteAttachment.findUniqueOrThrow({
    where: { id: outcome.attachment.id },
    select: { id: true, key: true },
  });
  return row;
}

/** 이 첨부를 참조하는 노트 수 — KAN-71 이후 '바인딩'은 이 표의 행이다. */
const refCount = (attachmentId: string) =>
  prisma.noteAttachmentRef.count({ where: { attachmentId } });
/** 이 노트가 이 첨부를 참조하는가. */
const isRefBy = async (noteId: string, attachmentId: string) =>
  (await prisma.noteAttachmentRef.count({ where: { noteId, attachmentId } })) === 1;
/** 첨부 행에 적힌 참조 수 색인 (KAN-74) — 권위는 위 참조 표에 있고 이건 스윕용 색인이다. */
const refCountColumn = async (attachmentId: string) =>
  (await prisma.noteAttachment.findUniqueOrThrow({
    where: { id: attachmentId },
    select: { refCount: true },
  })).refCount;

// 본문에 이미지 하나가 든 doc의 저장 문자열.
const docWithImage = (id: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'image', attrs: { src: `/api/notes/attachments/${id}` } }],
  });

describe('첨부 바인딩 (KAN-38)', () => {
  it('본문이 참조한 내 pending 첨부는 저장과 함께 노트에 묶인다', async () => {
    const noteId = await noteInA();
    const att = await pending(ORG_A, USER_OWNER);

    const outcome = await updateNote(ORG_A, noteId, { content: docWithImage(att.id) }, owner, [att.id]);

    expect(outcome.status).toBe('ok');
    expect(await isRefBy(noteId, att.id)).toBe(true);
  });

  it('다른 org의 첨부 id는 거부되고 본문 저장도 롤백된다', async () => {
    const noteId = await noteInA();
    const foreign = await pending(ORG_B, USER_OTHER);

    const outcome = await updateNote(
      ORG_A, noteId, { content: docWithImage(foreign.id) }, owner, [foreign.id],
    );

    expect(outcome.status).toBe('invalidattachment');
    const note = await prisma.note.findUniqueOrThrow({ where: { id: noteId } });
    expect(note.content).toBe('');
    expect(await refCount(foreign.id)).toBe(0);
  });

  // 위 테스트는 org와 업로더가 **함께** 다르다 — where가 uploaderId도 물기 때문에 orgId
  // 조건이 없어도 통과한다. 격리를 실제로 고정하는 건 이 케이스다: Clerk는 한 사용자가
  // 여러 워크스페이스의 멤버이므로, '내가 저쪽 org에서 올린 것'이 진짜 경계다.
  it('같은 사용자가 다른 org에서 올린 pending도 이 org 노트에 묶이지 않는다', async () => {
    const noteId = await noteInA();
    const mineElsewhere = await pending(ORG_B, USER_OWNER);

    const outcome = await updateNote(
      ORG_A, noteId, { content: docWithImage(mineElsewhere.id) }, owner, [mineElsewhere.id],
    );

    expect(outcome.status).toBe('invalidattachment');
    const row = await prisma.noteAttachment.findUniqueOrThrow({ where: { id: mineElsewhere.id } });
    expect(await refCount(mineElsewhere.id)).toBe(0);
    expect(row.orgId).toBe(ORG_B);
  });

  it('남의 pending 첨부도 묶을 수 없다 (업로더 본인만)', async () => {
    const noteId = await noteInA();
    const others = await pending(ORG_A, USER_OTHER);

    const outcome = await updateNote(
      ORG_A, noteId, { content: docWithImage(others.id) }, owner, [others.id],
    );

    expect(outcome.status).toBe('invalidattachment');
  });

  it('생성 시에도 바인딩된다 (createNote 경로)', async () => {
    const att = await pending(ORG_A, USER_OWNER);

    const outcome = await createNote(
      ORG_A, USER_OWNER, { title: '새 문서', content: docWithImage(att.id) }, [att.id],
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.status === 'ok' && (await isRefBy(outcome.note.id, att.id))).toBe(true);
  });
});

describe('미참조 정리와 삭제 (KAN-70 outbox)', () => {
  it('본문에서 빠진 첨부는 행이 지워지고 키가 outbox에 적힌다', async () => {
    const noteId = await noteInA();
    const att = await pending(ORG_A, USER_OWNER);
    await updateNote(ORG_A, noteId, { content: docWithImage(att.id) }, owner, [att.id]);

    // 이미지를 뺀 본문으로 다시 저장.
    const outcome = await updateNote(ORG_A, noteId, { content: '{"type":"doc"}' }, owner, []);

    expect(outcome.status).toBe('ok');
    expect(await prisma.noteAttachment.count({ where: { id: att.id } })).toBe(0);
    expect(await prisma.storageCleanup.count({ where: { kind: 'key', target: att.key } })).toBe(1);
  });

  it('노트를 지우면 바인딩된 키가 outbox에 적힌다', async () => {
    const noteId = await noteInA();
    const att = await pending(ORG_A, USER_OWNER);
    await updateNote(ORG_A, noteId, { content: docWithImage(att.id) }, owner, [att.id]);

    expect(await deleteNote(ORG_A, noteId, owner)).toBe('ok');

    expect(await prisma.noteAttachment.count()).toBe(0);
    expect(await prisma.storageCleanup.count({ where: { kind: 'key', target: att.key } })).toBe(1);
  });

  it('권한 없는 삭제 시도는 outbox에 아무것도 적지 않는다', async () => {
    const noteId = await noteInA();
    const att = await pending(ORG_A, USER_OWNER);
    await updateNote(ORG_A, noteId, { content: docWithImage(att.id) }, owner, [att.id]);

    expect(await deleteNote(ORG_A, noteId, { userId: USER_OTHER, isAdmin: false })).toBe('forbidden');

    expect(await prisma.storageCleanup.count()).toBe(0);
    expect(await prisma.noteAttachmentRef.count({ where: { noteId } })).toBe(1);
  });
});

describe('버려진 pending 스윕', () => {
  it('오래된 pending 노트 첨부를 걷어 outbox로 옮긴다', async () => {
    const att = await pending(ORG_A, USER_OWNER);
    await prisma.noteAttachment.update({
      where: { id: att.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const moved = await sweepAbandonedPending();

    expect(moved).toBe(1);
    expect(await prisma.noteAttachment.count()).toBe(0);
    expect(await prisma.storageCleanup.count({ where: { target: att.key } })).toBe(1);
  });

  it('바인딩된 첨부와 신선한 pending은 걷지 않는다', async () => {
    const noteId = await noteInA();
    const bound = await pending(ORG_A, USER_OWNER);
    await updateNote(ORG_A, noteId, { content: docWithImage(bound.id) }, owner, [bound.id]);
    // 바인딩된 쪽을 **오래된 것으로** 만든다. 신선한 채로 두면 나이 필터만으로 통과해
    // '참조가 있으면 안 걷는다'는 조건이 검증되지 않는다 — 그 조건을 지워도 초록이었다.
    await prisma.noteAttachment.update({
      where: { id: bound.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    await pending(ORG_A, USER_OWNER); // 신선한 pending

    expect(await sweepAbandonedPending()).toBe(0);
    expect(await prisma.noteAttachment.count()).toBe(2);
    expect(await prisma.storageCleanup.count()).toBe(0);
  });

  it('저장이 붙잡고 있는 첨부는 건너뛴다 (스윕이 산 참조를 지우지 않는다)', async () => {
    // 24h 넘게 열어 둔 초안 탭이 저장되는 순간 스윕과 겹치는 경우다. 잠금이 없으면 스윕은
    // 미커밋 참조를 못 보고 그 행을 지우며, cascade가 방금 만든 참조까지 데려간다.
    const att = await pending(ORG_A, USER_OWNER);
    await prisma.noteAttachment.update({
      where: { id: att.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    const note = await prisma.note.create({
      data: { orgId: ORG_A, authorId: USER_OWNER, title: '초안' },
    });

    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });

    const saving = prisma.$transaction(
      async (tx) => {
        await syncNoteAttachments(tx, ORG_A, USER_OWNER, note.id, [att.id]);
        signalLocked();
        await gate;
      },
      { timeout: 20000 },
    );
    await locked;

    const swept = await sweepAbandonedPending();
    openGate();
    await saving;

    expect(swept).toBe(0);
    expect(await prisma.noteAttachment.count({ where: { id: att.id } })).toBe(1);
    expect(await isRefBy(note.id, att.id)).toBe(true);
    expect(await prisma.storageCleanup.count()).toBe(0);
  });
});

describe('createPendingNoteAttachment — 업로드 자리', () => {
  it('org·사용자 미러가 아직 없어도 자리를 내준다 (웹훅 지연 경합, KAN-11)', async () => {
    // 노트 이미지는 첫 문서를 저장하기도 전에 쓰이는 첫 write다 — 채팅 첨부처럼 앞선
    // 채널 조회가 Organization 행을 보장해 주지 않는다. 스켈레톤이 빠지면 FK로 죽는다.
    await prisma.organization.deleteMany({ where: { id: ORG_A } });
    await prisma.user.deleteMany({ where: { id: USER_OWNER } });

    const outcome = await createPendingNoteAttachment(ORG_A, USER_OWNER, IMAGE);

    expect(outcome.status).toBe('ok');
    expect(await prisma.organization.count({ where: { id: ORG_A } })).toBe(1);
    // User 미러는 만들지 않는다 — uploaderId에는 FK가 없어 필요 없고, 만들면 웹훅이 언급한
    // 적 없는 사용자 행이 presign의 부수효과로 생긴다 (KAN-72).
    expect(await prisma.user.count({ where: { id: USER_OWNER } })).toBe(0);
  });

  it('삭제된 조직(tombstone)의 업로드는 거부되고 스켈레톤도 부활하지 않는다', async () => {
    await prisma.organization.deleteMany({ where: { id: ORG_A } });
    await prisma.clerkTombstone.create({ data: { id: ORG_A } });

    await expect(createPendingNoteAttachment(ORG_A, USER_OWNER, IMAGE)).rejects.toThrow();

    expect(await prisma.noteAttachment.count()).toBe(0);
    expect(await prisma.organization.count({ where: { id: ORG_A } })).toBe(0);
  });

  it('삭제된 사용자(tombstone)의 업로드는 거부된다', async () => {
    await prisma.clerkTombstone.create({ data: { id: USER_OWNER } });

    await expect(createPendingNoteAttachment(ORG_A, USER_OWNER, IMAGE)).rejects.toThrow();

    expect(await prisma.noteAttachment.count()).toBe(0);
  });
});

describe('resolveNoteAttachmentUrl — 접근 판정', () => {
  /** 바인딩까지 끝난 첨부 하나. */
  async function bound(): Promise<{ id: string; key: string }> {
    const noteId = await noteInA();
    const att = await pending(ORG_A, USER_OWNER);
    await updateNote(ORG_A, noteId, { content: docWithImage(att.id) }, owner, [att.id]);
    return att;
  }

  it('바인딩된 이미지는 org 멤버 누구나 볼 수 있다 (노트는 org 전체 공개)', async () => {
    const att = await bound();
    const url = await resolveNoteAttachmentUrl(ORG_A, USER_OTHER, att.id, false);
    expect(url).not.toBeNull();
    // 안전한 이미지 타입은 inline으로 서빙된다.
    expect(url).toContain(`${DISPOSITION}inline`);
  });

  it('남의 워크스페이스에서는 id를 알아도 아예 없다', async () => {
    const att = await bound();
    expect(await resolveNoteAttachmentUrl(ORG_B, USER_OWNER, att.id, false)).toBeNull();
    expect(await resolveNoteAttachmentUrl(ORG_B, USER_OTHER, att.id, false)).toBeNull();
  });

  it('저장 전 pending은 업로더 본인만 본다 (에디터 미리보기 경로)', async () => {
    const att = await pending(ORG_A, USER_OWNER);
    expect(await resolveNoteAttachmentUrl(ORG_A, USER_OWNER, att.id, false)).not.toBeNull();
    expect(await resolveNoteAttachmentUrl(ORG_A, USER_OTHER, att.id, false)).toBeNull();
  });

  it('download 강제는 attachment로 내린다', async () => {
    const att = await bound();
    const url = await resolveNoteAttachmentUrl(ORG_A, USER_OWNER, att.id, true);
    expect(url).toContain(`${DISPOSITION}attachment`);
  });

  it('없는 id는 조용히 null이다 (존재 오라클 없음)', async () => {
    expect(await resolveNoteAttachmentUrl(ORG_A, USER_OWNER, 'att_ghost', false)).toBeNull();
  });
});

describe('수명 — 행은 테넌트와 함께 사라진다', () => {
  it('조직 삭제가 바인딩·pending 행을 모두 파기한다 (cascade, 규약 6)', async () => {
    const noteId = await noteInA();
    const att = await pending(ORG_A, USER_OWNER);
    await updateNote(ORG_A, noteId, { content: docWithImage(att.id) }, owner, [att.id]);
    await pending(ORG_A, USER_OWNER); // 바인딩 안 된 pending도 하나
    expect(await prisma.noteAttachment.count()).toBe(2);

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.noteAttachment.count()).toBe(0);
  });
});

// KAN-71 — 1:1 시절에는 이미지 블록을 다른 문서로 복사하는 정상 흐름이 '남의 첨부를 실어
// 왔다'와 구분되지 않아 저장이 통째로 거부됐고, 원본에서 그 이미지를 빼는 순간 오브젝트까지
// 지워져 복사본이 영영 저장 불가가 됐다. 참조를 1:N으로 떼면서 그 부류가 닫힌다.
describe('이미지를 여러 문서가 함께 참조한다 (KAN-71)', () => {
  /** 노트 하나를 만들고 이미지를 넣어 저장한다. */
  async function noteWithImage(attachmentId: string, title = '문서'): Promise<string> {
    const outcome = await createNote(
      ORG_A, USER_OWNER, { title, content: docWithImage(attachmentId) }, [attachmentId],
    );
    if (outcome.status !== 'ok') throw new Error(`저장 실패: ${outcome.status}`);
    return outcome.note.id;
  }

  it('같은 이미지를 다른 문서에 붙여넣어도 저장된다', async () => {
    const att = await pending(ORG_A, USER_OWNER);
    const first = await noteWithImage(att.id, '노트1');

    const second = await createNote(
      ORG_A, USER_OWNER, { title: '노트2', content: docWithImage(att.id) }, [att.id],
    );

    expect(second.status).toBe('ok');
    expect(await refCount(att.id)).toBe(2);
    expect(await isRefBy(first, att.id)).toBe(true);
  });

  it('원본에서 이미지를 빼도 다른 문서가 쓰는 한 오브젝트는 남는다', async () => {
    const att = await pending(ORG_A, USER_OWNER);
    const first = await noteWithImage(att.id, '노트1');
    const second = await noteWithImage(att.id, '노트2');

    // 노트1에서 이미지를 뺀다 — 1:1 시절에는 여기서 키가 삭제 outbox로 갔다.
    await updateNote(ORG_A, first, { content: '{"type":"doc"}' }, owner, []);

    expect(await refCount(att.id)).toBe(1);
    expect(await isRefBy(second, att.id)).toBe(true);
    expect(await prisma.noteAttachment.count({ where: { id: att.id } })).toBe(1);
    expect(await prisma.storageCleanup.count({ where: { target: att.key } })).toBe(0);

    // 그리고 노트2는 계속 저장된다(옛 구조에서는 여기서 영구히 막혔다).
    const resave = await updateNote(ORG_A, second, { content: docWithImage(att.id) }, owner, [att.id]);
    expect(resave.status).toBe('ok');
  });

  it('마지막 참조가 사라질 때만 오브젝트를 지운다', async () => {
    const att = await pending(ORG_A, USER_OWNER);
    const first = await noteWithImage(att.id, '노트1');
    const second = await noteWithImage(att.id, '노트2');

    await updateNote(ORG_A, first, { content: '{"type":"doc"}' }, owner, []);
    expect(await prisma.storageCleanup.count({ where: { target: att.key } })).toBe(0);

    await updateNote(ORG_A, second, { content: '{"type":"doc"}' }, owner, []);
    expect(await prisma.noteAttachment.count({ where: { id: att.id } })).toBe(0);
    expect(await prisma.storageCleanup.count({ where: { kind: 'key', target: att.key } })).toBe(1);
  });

  it('노트를 지워도 다른 문서가 쓰는 이미지는 남는다', async () => {
    const att = await pending(ORG_A, USER_OWNER);
    const first = await noteWithImage(att.id, '노트1');
    const second = await noteWithImage(att.id, '노트2');

    expect(await deleteNote(ORG_A, first, owner)).toBe('ok');

    expect(await refCount(att.id)).toBe(1);
    expect(await prisma.noteAttachment.count({ where: { id: att.id } })).toBe(1);
    expect(await prisma.storageCleanup.count({ where: { target: att.key } })).toBe(0);

    // 마지막 참조자를 지우면 그때 정리된다.
    expect(await deleteNote(ORG_A, second, owner)).toBe('ok');
    expect(await prisma.noteAttachment.count()).toBe(0);
    expect(await prisma.storageCleanup.count({ where: { kind: 'key', target: att.key } })).toBe(1);
  });

  it('다른 사람도 이미 쓰이고 있는 이미지를 자기 문서에서 인용할 수 있다 (노트는 org 공개)', async () => {
    const att = await pending(ORG_A, USER_OWNER);
    await noteWithImage(att.id, '원본');

    const theirs = await createNote(
      ORG_A, USER_OTHER, { title: '남의 문서', content: docWithImage(att.id) }, [att.id],
    );

    expect(theirs.status).toBe('ok');
    expect(await refCount(att.id)).toBe(2);
  });

  it('아직 아무 데서도 안 쓰이는 남의 pending은 여전히 인용할 수 없다', async () => {
    const theirPending = await pending(ORG_A, USER_OTHER);

    const mine = await createNote(
      ORG_A, USER_OWNER, { title: '내 문서', content: docWithImage(theirPending.id) }, [theirPending.id],
    );

    expect(mine.status).toBe('invalidattachment');
    expect(await refCount(theirPending.id)).toBe(0);
  });

  it('제목만 고치는 저장은 참조를 건드리지 않는다', async () => {
    // 이 표를 통째로 비울 수 있는 유일한 경로다 — updateNote는 partial이라 title만 오는
    // 저장(사이드바 이름 변경)이 실제 경로이고, content 가드가 빠지면 attachmentIds=[]로
    // sync가 돌아 그 노트의 참조가 전부 끊기고 마지막 참조면 오브젝트까지 지워진다.
    const att = await pending(ORG_A, USER_OWNER);
    const noteId = await noteWithImage(att.id, '노트1');

    const renamed = await updateNote(ORG_A, noteId, { title: '새 제목' }, owner);

    expect(renamed.status).toBe('ok');
    expect(await isRefBy(noteId, att.id)).toBe(true);
    expect(await prisma.noteAttachment.count({ where: { id: att.id } })).toBe(1);
    expect(await prisma.storageCleanup.count({ where: { target: att.key } })).toBe(0);
  });

  it('같은 이미지를 한 문서에 두 번 넣어도 저장된다', async () => {
    // 수집기가 Set이라 지금은 중복이 안 오지만, 대조가 호출자의 dedupe에 기대면 수집기가
    // Set을 잃는 날 그런 문서가 전부 영구 저장 불가가 된다(1 !== 2 → invalidattachment).
    const att = await pending(ORG_A, USER_OWNER);
    const image = { type: 'image', attrs: { src: `/api/notes/attachments/${att.id}` } };
    const doc = JSON.stringify({ type: 'doc', content: [image, image] });

    const outcome = await createNote(ORG_A, USER_OWNER, { title: '두 번', content: doc }, [
      att.id,
      att.id,
    ]);

    expect(outcome.status).toBe('ok');
    expect(await refCount(att.id)).toBe(1);
  });

  it('참조 수 색인이 참조 표를 따라간다 (KAN-74 — 스윕이 후보를 인덱스로 좁히는 근거)', async () => {
    const att = await pending(ORG_A, USER_OWNER);
    expect(await refCountColumn(att.id)).toBe(0);

    const first = await noteWithImage(att.id, '노트1');
    expect(await refCountColumn(att.id)).toBe(1);

    const second = await noteWithImage(att.id, '노트2');
    expect(await refCountColumn(att.id)).toBe(2);

    // 한쪽에서 빼면 1로, 마지막 참조가 사라지면 행 자체가 사라진다.
    await updateNote(ORG_A, first, { content: '{"type":"doc"}' }, owner, []);
    expect(await refCountColumn(att.id)).toBe(1);

    expect(await deleteNote(ORG_A, second, owner)).toBe('ok');
    expect(await prisma.noteAttachment.count({ where: { id: att.id } })).toBe(0);
  });

  it('deleteNote를 거치지 않고 노트가 사라져도 그 첨부는 스윕이 걷는다', async () => {
    // createNote의 tombstone post-check는 서비스 코드를 거치지 않고 note.deleteMany로 지운다
    // — 참조 행은 cascade로 사라진다. 색인을 애플리케이션이 갱신하는 구조였다면 refCount가
    // 1로 굳어 이 첨부는 스윕 후보로 **영영** 올라오지 못하고 행과 오브젝트가 영구히 남는다.
    // 색인 유지가 DB 트리거라 cascade도 덮인다(KAN-74).
    const att = await pending(ORG_A, USER_OWNER);
    const noteId = await noteWithImage(att.id, '노트1');
    expect(await refCountColumn(att.id)).toBe(1);

    await prisma.note.deleteMany({ where: { id: noteId } });

    expect(await refCountColumn(att.id)).toBe(0);
    await prisma.noteAttachment.update({
      where: { id: att.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    expect(await sweepAbandonedPending()).toBe(1);
    expect(await prisma.noteAttachment.count({ where: { id: att.id } })).toBe(0);
    expect(await prisma.storageCleanup.count({ where: { target: att.key } })).toBe(1);
  });

  it('색인이 어긋나도 참조가 있으면 스윕이 지우지 않고, 색인을 고쳐 둔다', async () => {
    // 색인(refCount)은 후보를 좁히는 용도일 뿐 판정의 권위가 아니다. 어긋난 값이 후보를
    // 만들어도 삭제문의 NOT EXISTS가 막아야 하고, 그대로 두면 매 회차 배치 자리를 차지하므로
    // 스윕이 고쳐 둬야 한다.
    const att = await pending(ORG_A, USER_OWNER);
    const noteId = await noteWithImage(att.id, '노트1');
    await prisma.$executeRaw`UPDATE "NoteAttachment" SET "refCount" = 0 WHERE "id" = ${att.id}`;
    await prisma.noteAttachment.update({
      where: { id: att.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    expect(await sweepAbandonedPending()).toBe(0);

    expect(await prisma.noteAttachment.count({ where: { id: att.id } })).toBe(1);
    expect(await isRefBy(noteId, att.id)).toBe(true);
    expect(await prisma.storageCleanup.count()).toBe(0);
    expect(await refCountColumn(att.id)).toBe(1);
  });

  it('참조를 놓는 저장과 잡는 저장이 겹쳐도 산 참조를 지우지 않는다', async () => {
    // 판정('참조가 0인가')과 삭제 사이에 다른 노트가 참조를 커밋하면, 잠금이 없을 때
    // DELETE가 그 참조를 못 보고 ON DELETE CASCADE가 산 참조까지 지운다 — 그 노트는
    // 본문에 이미지가 있는데 행이 없어 영구히 저장 불가가 된다(KAN-71 증상의 재발).
    const att = await pending(ORG_A, USER_OWNER);
    const holder = await noteWithImage(att.id, '노트1');
    const other = await prisma.note.create({
      data: { orgId: ORG_A, authorId: USER_OWNER, title: '노트2' },
    });

    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let signalBound!: () => void;
    const bound = new Promise<void>((resolve) => {
      signalBound = resolve;
    });

    // 잡는 쪽: 참조를 만들고 커밋하지 않은 채 대기한다.
    const binder = prisma.$transaction(
      async (tx) => {
        await syncNoteAttachments(tx, ORG_A, USER_OWNER, other.id, [att.id]);
        signalBound();
        await gate;
      },
      { timeout: 20000 },
    );

    await bound;
    // 놓는 쪽: 노트1에서 이미지를 뺀다 — 잠금이 있으면 여기서 막혔다가 새 참조를 본다.
    const releaser = prisma.$transaction(
      async (tx) => {
        await syncNoteAttachments(tx, ORG_A, USER_OWNER, holder, []);
      },
      { timeout: 20000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    openGate();
    await Promise.all([binder, releaser]);

    expect(await prisma.noteAttachment.count({ where: { id: att.id } })).toBe(1);
    expect(await isRefBy(other.id, att.id)).toBe(true);
    expect(await prisma.storageCleanup.count({ where: { target: att.key } })).toBe(0);
  });
});
