import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { prisma } from '@/server/db';
import { ORG_A, ORG_B, USER_OWNER, resetDatabase, seedTenants } from '../../../../../../test/db';
import { NOTE_DOC_FIELD } from '@/features/notes/doc-field';

// 세션만 대역으로 세운다 — Clerk 세션을 HTTP로 만들 수 없어서다. 나머지(DB·서비스·검증)는
// 전부 실물이라, 이 파일이 검증하는 것은 라우트 계층의 판정·직렬화·상한이다.
const authState = vi.fn();
vi.mock('@/server/auth', () => ({ getAuthState: () => authState() }));
// Pusher 키가 없는 환경(로컬·CI)에서는 pusherServer가 null이라 브로드캐스트는 건너뛴다.
// 팬아웃 자체는 여기서 검증하지 않는다 — 키가 있어야 확인되는 부분이다.

const { GET, POST } = await import('./route');

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
  authState.mockResolvedValue({ userId: USER_OWNER, orgId: ORG_A });
});

const params = (noteId: string) => ({ params: Promise.resolve({ noteId }) });
const req = (body?: unknown) =>
  new Request('http://localhost/api/notes/x/doc', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function noteInA(content = ''): Promise<string> {
  const note = await prisma.note.create({
    data: { orgId: ORG_A, authorId: USER_OWNER, title: '문서', content },
  });
  return note.id;
}

const docWith = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

/** 스냅샷을 받아 문단을 덧붙이고 그 델타를 base64로 — 브라우저 클라이언트가 하는 일. */
async function clientEdit(noteId: string, text: string): Promise<string> {
  const response = await GET(new Request('http://localhost'), params(noteId));
  const body = (await response.json()) as { update: string };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(body.update, 'base64'));
  const before = Y.encodeStateVector(doc);
  const el = new Y.XmlElement('paragraph');
  el.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment(NOTE_DOC_FIELD).push([el]);
  return Buffer.from(Y.encodeStateAsUpdate(doc, before)).toString('base64');
}

async function textsOf(noteId: string): Promise<string[]> {
  const response = await GET(new Request('http://localhost'), params(noteId));
  const body = (await response.json()) as { update: string };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(body.update, 'base64'));
  return doc
    .getXmlFragment(NOTE_DOC_FIELD)
    .toArray()
    .map((node) => node.toString().replace(/<[^>]+>/g, ''));
}

describe('doc 라우트 — 접근 판정', () => {
  it('세션이 없으면 401', async () => {
    authState.mockResolvedValue({ userId: null, orgId: null });
    expect((await GET(new Request('http://localhost'), params('x'))).status).toBe(401);
    expect((await POST(req({ update: 'AA==' }), params('x'))).status).toBe(401);
  });

  it('남의 워크스페이스 문서는 GET·POST 모두 404 (존재 오라클 없음)', async () => {
    const note = await prisma.note.create({
      data: { orgId: ORG_B, authorId: USER_OWNER, title: '남의 문서' },
    });
    expect((await GET(new Request('http://localhost'), params(note.id))).status).toBe(404);
    const update = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64');
    expect((await POST(req({ update }), params(note.id))).status).toBe(404);
    expect(await prisma.noteDocUpdate.count()).toBe(0);
  });

  it('없는 문서도 같은 404다', async () => {
    expect((await GET(new Request('http://localhost'), params('nope'))).status).toBe(404);
  });
});

describe('doc 라우트 — 입력 검증', () => {
  it('업데이트가 없거나 빈 바이트면 400', async () => {
    const noteId = await noteInA();
    expect((await POST(req({}), params(noteId))).status).toBe(400);
    expect((await POST(req({ update: '' }), params(noteId))).status).toBe(400);
    expect((await POST(req(), params(noteId))).status).toBe(400);
    expect(await prisma.noteDocUpdate.count()).toBe(0);
  });

  it('상한을 넘는 업데이트는 400 — 저장도 안 된다', async () => {
    const noteId = await noteInA();
    const huge = Buffer.alloc(600 * 1024, 1).toString('base64');
    expect((await POST(req({ update: huge }), params(noteId))).status).toBe(400);
    expect(await prisma.noteDocUpdate.count()).toBe(0);
  });
});

describe('doc 라우트 — 두 편집자의 수렴', () => {
  it('같은 시작 상태에서 갈라진 두 편집이 모두 남는다', async () => {
    const noteId = await noteInA(docWith('공통'));
    // 서로의 편집을 보지 못한 채 각자 만든 델타 — 실시간이 꺼져 있어도 서버에서 합쳐진다.
    const alice = await clientEdit(noteId, '앨리스');
    const bob = await clientEdit(noteId, '밥');

    expect((await POST(req({ update: alice }), params(noteId))).status).toBe(200);
    expect((await POST(req({ update: bob }), params(noteId))).status).toBe(200);

    const texts = await textsOf(noteId);
    expect(texts).toEqual(expect.arrayContaining(['공통', '앨리스', '밥']));
  });

  it('버전은 단조 증가한다 — 클라이언트가 따라잡을 기준이다', async () => {
    const noteId = await noteInA(docWith('처음'));
    const first = (await (
      await POST(req({ update: await clientEdit(noteId, 'a') }), params(noteId))
    ).json()) as { version: string };
    const second = (await (
      await POST(req({ update: await clientEdit(noteId, 'b') }), params(noteId))
    ).json()) as { version: string };

    expect(BigInt(second.version)).toBeGreaterThan(BigInt(first.version));
  });

  it('편집이 content로 구체화된다 (첫 요청은 리밋이 열려 있다)', async () => {
    const noteId = await noteInA(docWith('처음'));
    await POST(req({ update: await clientEdit(noteId, '나중') }), params(noteId));

    const note = await prisma.note.findUniqueOrThrow({ where: { id: noteId } });
    expect(note.content).toContain('나중');
  });

  it('구체화는 간격을 둔다 — 연속 편집이 매번 문서를 다시 만들지 않는다', async () => {
    const noteId = await noteInA(docWith('처음'));
    await POST(req({ update: await clientEdit(noteId, '하나') }), params(noteId));
    await POST(req({ update: await clientEdit(noteId, '둘') }), params(noteId));

    // 두 번째는 리밋에 걸려 구체화가 건너뛰어진다 — Yjs 상태에는 있고 content에는 아직 없다.
    const note = await prisma.note.findUniqueOrThrow({ where: { id: noteId } });
    expect(note.content).not.toContain('둘');
    expect(await textsOf(noteId)).toContain('둘');
  });
});
