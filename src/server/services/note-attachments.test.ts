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
import { sweepAbandonedPending } from './storage-cleanup';

const owner = { userId: USER_OWNER, isAdmin: false };

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

// presign 없이 pending 행을 직접 만든다(스토리지 env가 없는 테스트 환경).
async function pending(orgId: string, uploaderId: string): Promise<{ id: string; key: string }> {
  const key = `org/${orgId}/att/${crypto.randomUUID()}`;
  const row = await prisma.noteAttachment.create({
    data: { orgId, uploaderId, key, fileName: 'a.png', contentType: 'image/png', size: 10 },
  });
  return { id: row.id, key };
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
