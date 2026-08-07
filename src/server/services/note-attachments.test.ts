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
import { createPendingNoteAttachment, resolveNoteAttachmentUrl } from './note-attachments';
import { sweepAbandonedPending } from './storage-cleanup';

const owner = { userId: USER_OWNER, isAdmin: false };

const IMAGE = { fileName: 'a.png', contentType: 'image/png', size: 10 };

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
    const row = await prisma.noteAttachment.findUniqueOrThrow({ where: { id: att.id } });
    expect(row.noteId).toBe(noteId);
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
    const row = await prisma.noteAttachment.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(row.noteId).toBeNull();
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
    expect(row.noteId).toBeNull();
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
    const row = await prisma.noteAttachment.findUniqueOrThrow({ where: { id: att.id } });
    expect(outcome.status === 'ok' && row.noteId === outcome.note.id).toBe(true);
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
    expect(await prisma.noteAttachment.count({ where: { noteId } })).toBe(1);
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
    await pending(ORG_A, USER_OWNER); // 신선한 pending

    expect(await sweepAbandonedPending()).toBe(0);
    expect(await prisma.noteAttachment.count()).toBe(2);
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
    expect(await prisma.user.count({ where: { id: USER_OWNER } })).toBe(1);
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
    expect(url).toContain('inline');
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
    expect(await resolveNoteAttachmentUrl(ORG_A, USER_OWNER, att.id, true)).toContain('attachment');
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
