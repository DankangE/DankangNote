import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { prisma } from '@/server/db';
import { ORG_A, ORG_B, USER_OWNER, resetDatabase, seedTenants } from '../../../test/db';
import {
  NOTE_DOC_FIELD,
  appendNoteDocUpdate,
  loadNoteDoc,
  materializeNoteDoc,
} from './note-doc';
import { createPendingNoteAttachment } from './note-attachments';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
});

const docWith = (...text: string[]) =>
  JSON.stringify({
    type: 'doc',
    content: text.map((t) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: t }],
    })),
  });

async function noteInA(content = ''): Promise<string> {
  const note = await prisma.note.create({
    data: { orgId: ORG_A, authorId: USER_OWNER, title: '문서', content },
  });
  return note.id;
}

/** 클라이언트 한 명을 흉내 낸다 — 스냅샷을 받아 편집하고 그 델타만 돌려준다. */
async function edit(
  noteId: string,
  mutate: (fragment: Y.XmlFragment) => void,
): Promise<Uint8Array> {
  const snapshot = await loadNoteDoc(ORG_A, noteId);
  if (!snapshot) throw new Error('스냅샷 없음');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot.update);
  const before = Y.encodeStateVector(doc);
  mutate(doc.getXmlFragment(NOTE_DOC_FIELD));
  return Y.encodeStateAsUpdate(doc, before);
}

const paragraph = (text: string) => {
  const el = new Y.XmlElement('paragraph');
  el.insert(0, [new Y.XmlText(text)]);
  return el;
};

/** 스냅샷을 문서 JSON으로 되돌린다(어서션용). */
function textsOf(update: Uint8Array): string[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc
    .getXmlFragment(NOTE_DOC_FIELD)
    .toArray()
    .map((node) => node.toString().replace(/<[^>]+>/g, ''));
}

describe('loadNoteDoc — 초기 상태', () => {
  it('공동 편집 이전 노트는 content에서 Yjs 상태를 만든다', async () => {
    const noteId = await noteInA(docWith('첫 문단'));

    const snapshot = await loadNoteDoc(ORG_A, noteId);

    expect(snapshot).not.toBeNull();
    expect(textsOf(snapshot!.update)).toEqual(['첫 문단']);
  });

  it('빈 본문도 문서로 연다', async () => {
    const noteId = await noteInA('');
    const snapshot = await loadNoteDoc(ORG_A, noteId);
    expect(textsOf(snapshot!.update)).toEqual([]);
  });

  it('남의 워크스페이스 문서는 열리지 않는다', async () => {
    const note = await prisma.note.create({
      data: { orgId: ORG_B, authorId: USER_OWNER, title: '남의 문서' },
    });
    expect(await loadNoteDoc(ORG_A, note.id)).toBeNull();
  });
});

describe('appendNoteDocUpdate — 업데이트 로그', () => {
  it('쌓은 업데이트가 다음 스냅샷에 반영된다', async () => {
    const noteId = await noteInA(docWith('처음'));
    const update = await edit(noteId, (fragment) => fragment.push([paragraph('덧붙임')]));

    const version = await appendNoteDocUpdate(ORG_A, noteId, update);

    expect(version).not.toBeNull();
    const snapshot = await loadNoteDoc(ORG_A, noteId);
    expect(textsOf(snapshot!.update)).toEqual(['처음', '덧붙임']);
    expect(snapshot!.version).toBe(version);
  });

  it('두 편집자가 같은 문서를 동시에 고쳐도 둘 다 남는다 (CRDT 수렴)', async () => {
    const noteId = await noteInA(docWith('공통'));
    // 둘 다 **같은 시작 상태**에서 갈라진다 — 서로의 편집을 보지 못한 채 만든 델타다.
    const fromAlice = await edit(noteId, (fragment) => fragment.push([paragraph('앨리스')]));
    const fromBob = await edit(noteId, (fragment) => fragment.push([paragraph('밥')]));

    await appendNoteDocUpdate(ORG_A, noteId, fromAlice);
    await appendNoteDocUpdate(ORG_A, noteId, fromBob);

    const texts = textsOf((await loadNoteDoc(ORG_A, noteId))!.update);
    expect(texts).toContain('앨리스');
    expect(texts).toContain('밥');
    expect(texts).toContain('공통');
  });

  it('남의 워크스페이스 문서에는 쌓을 수 없다', async () => {
    const note = await prisma.note.create({
      data: { orgId: ORG_B, authorId: USER_OWNER, title: '남의 문서' },
    });
    expect(await appendNoteDocUpdate(ORG_A, note.id, new Uint8Array([1, 2]))).toBeNull();
    expect(await prisma.noteDocUpdate.count()).toBe(0);
  });
});

describe('materializeNoteDoc — 화면이 읽는 content로 접기', () => {
  it('Yjs 편집이 content에 반영된다', async () => {
    const noteId = await noteInA(docWith('처음'));
    await appendNoteDocUpdate(
      ORG_A,
      noteId,
      await edit(noteId, (fragment) => fragment.push([paragraph('나중')])),
    );

    expect(await materializeNoteDoc(ORG_A, noteId, USER_OWNER)).toBe('ok');

    const note = await prisma.note.findUniqueOrThrow({ where: { id: noteId } });
    const content = JSON.parse(note.content) as { content: { content: { text: string }[] }[] };
    expect(content.content.map((n) => n.content[0]!.text)).toEqual(['처음', '나중']);
  });

  it('구체화는 멱등이다 — 두 번째 호출은 쓰지 않는다', async () => {
    const noteId = await noteInA(docWith('처음'));
    await appendNoteDocUpdate(
      ORG_A,
      noteId,
      await edit(noteId, (fragment) => fragment.push([paragraph('나중')])),
    );

    expect(await materializeNoteDoc(ORG_A, noteId, USER_OWNER)).toBe('ok');
    expect(await materializeNoteDoc(ORG_A, noteId, USER_OWNER)).toBe('unchanged');
  });

  it('우리 라우트가 아닌 이미지는 문서 전체를 거부하지 않고 그 노드만 떨군다', async () => {
    // CRDT 업데이트는 서버가 해석하지 않으므로, 저장 액션의 화이트리스트를 우회해 외부
    // 이미지를 심을 수 있는 유일한 경로다. 거부하면 content가 옛 상태로 영원히 굳는다 —
    // 그래서 같은 편집에 실린 **정상 문단은 살아남아야** 한다. 그 둘을 함께 넣어야
    // '떨궜다'와 '문서째 거부했다'가 구분된다.
    const noteId = await noteInA(docWith('본문'));
    const update = await edit(noteId, (fragment) => {
      const img = new Y.XmlElement('image');
      img.setAttribute('src', 'https://evil.example.com/x.png');
      fragment.push([img, paragraph('같이 친 문단')]);
    });
    await appendNoteDocUpdate(ORG_A, noteId, update);

    expect(await materializeNoteDoc(ORG_A, noteId, USER_OWNER)).toBe('ok');

    const note = await prisma.note.findUniqueOrThrow({ where: { id: noteId } });
    expect(note.content).not.toContain('evil.example.com');
    expect(note.content).toContain('본문');
    expect(note.content).toContain('같이 친 문단');
  });

  it('본문이 참조하는 첨부는 구체화가 노트에 묶는다', async () => {
    const noteId = await noteInA(docWith('본문'));
    const presign = await createPendingNoteAttachment(ORG_A, USER_OWNER, {
      fileName: 'a.png',
      contentType: 'image/png',
      size: 10,
    });
    if (presign.status !== 'ok') throw new Error('presign 실패');
    const attachmentId = presign.attachment.id;

    const update = await edit(noteId, (fragment) => {
      const img = new Y.XmlElement('image');
      img.setAttribute('src', `/api/notes/attachments/${attachmentId}`);
      fragment.push([img]);
    });
    await appendNoteDocUpdate(ORG_A, noteId, update);

    expect(await materializeNoteDoc(ORG_A, noteId, USER_OWNER)).toBe('ok');
    expect(
      await prisma.noteAttachmentRef.count({ where: { noteId, attachmentId } }),
    ).toBe(1);
  });

  it('없는 문서는 notfound', async () => {
    expect(await materializeNoteDoc(ORG_A, 'nope', USER_OWNER)).toBe('notfound');
  });
});
