import 'server-only';

import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import type { JSONContent } from '@tiptap/core';
import { prisma } from '@/server/db';
import { noteEditorExtensions } from '@/features/notes/editor';
import { noteContentSchema } from '@/features/notes/api/validation';
import { parseNoteContent } from '@/features/notes/content';
import {
  NOTE_ATTACHMENT_ROUTE,
  NOTE_ATTACHMENT_SRC_RE,
  collectNoteAttachmentIds,
} from '@/features/notes/attachments';
import {
  syncNoteAttachments,
  usableNoteAttachmentWhere,
} from '@/server/services/note-attachments';
import { ownedNoteWhere, type NoteActor } from '@/server/services/notes';
import { NOTE_DOC_FIELD } from '@/features/notes/doc-field';

// 실시간 공동 편집 (KAN-39) — 문서의 진실이 편집 중에는 Yjs 상태로 옮겨간다.
//
// 전송은 채팅과 같은 골격이다: 업데이트를 우리 라우트로 받아 판정·기록하고 Pusher로
// 퍼뜨린다. Pusher 클라이언트 이벤트를 쓰면 서버를 아예 건너뛸 수 있지만 그러면 '이 문서를
// 볼 수 있는가'를 우리가 판정할 자리가 사라진다(타이핑 핑에서 내린 것과 같은 결정, KAN-34).
// Vercel에는 상주 WebSocket 서버를 둘 수 없다는 제약도 같은 방향을 가리킨다.

export { NOTE_DOC_FIELD } from '@/features/notes/doc-field';

/** 접기 임계 — 이만큼 쌓이면 다음 쓰기가 docState로 접고 접힌 몫을 지운다. */
const COMPACT_THRESHOLD = 200;

const schema = getSchema(noteEditorExtensions);

export interface NoteDocSnapshot {
  /** 현재 상태 전체를 담은 하나의 Yjs 업데이트. */
  update: Uint8Array;
  /** 이 스냅샷에 반영된 마지막 업데이트 로그 id (0이면 로그가 비어 있다). */
  version: bigint;
}

/**
 * 편집 중인 문서의 현재 상태를 하나의 업데이트로 접어 돌려준다 — 클라이언트의 초기 로드와
 * 재동기화가 쓴다.
 *
 * docState가 없으면 **content에서 만든다**. 공동 편집 이전에 저장된 노트에는 Yjs 상태가
 * 없고, 그때는 content가 유일한 진실이다. 이 변환을 클라이언트가 하면 두 편집자가 각자
 * 만든 서로 다른 Y.Doc이 합쳐지며 본문이 두 벌로 겹친다 — 서버가 한 번만 만들어야 한다.
 */
export async function loadNoteDoc(orgId: string, noteId: string): Promise<NoteDocSnapshot | null> {
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId },
    select: { content: true, docState: true },
  });
  if (!note) return null;

  const doc = new Y.Doc();
  Y.applyUpdate(doc, await ensureDocState(noteId, note));

  const updates = await prisma.noteDocUpdate.findMany({
    where: { noteId },
    orderBy: { id: 'asc' },
    select: { id: true, update: true },
  });
  for (const row of updates) {
    Y.applyUpdate(doc, new Uint8Array(row.update));
  }

  return {
    update: Y.encodeStateAsUpdate(doc),
    version: updates.length > 0 ? updates[updates.length - 1]!.id : BigInt(0),
  };
}

/**
 * 업데이트를 로그에 쌓는다. 반환은 로그 id — 클라이언트가 '어디까지 받았는지'를 이 값으로
 * 표현한다.
 *
 * 서버는 바이트를 해석하지 않는다. CRDT 델타는 부분적으로만 의미가 있어서 한 조각만 보고
 * '이 편집이 허용되는가'를 판정할 수 없기 때문이다 — 검증은 완성된 문서에 대해
 * materializeNoteDoc이 한다.
 *
 * 편집 권한은 **저장 액션과 같은 where**를 쓴다(ownedNoteWhere — 작성자 또는 admin).
 * 처음에는 org 스코프만 봤는데, 그러면 updateNote가 forbidden으로 막는 사람이 이 라우트로는
 * 남의 문서를 고칠 수 있었다. UI가 편집 버튼을 숨기는 것은 판정이 아니다(규약 10).
 * 노트 **읽기**는 지금도 org 전체 공개라 GET에는 이 조건이 없다.
 */
export async function appendNoteDocUpdate(
  orgId: string,
  noteId: string,
  actor: NoteActor,
  update: Uint8Array,
): Promise<bigint | null> {
  const note = await prisma.note.findFirst({
    where: ownedNoteWhere(orgId, noteId, actor),
    select: { id: true },
  });
  if (!note) return null;

  const row = await prisma.noteDocUpdate.create({
    data: { noteId, update: Buffer.from(update) },
    select: { id: true },
  });
  await compactIfNeeded(noteId);
  return row.id;
}

/**
 * 로그가 길어지면 docState로 접고 접힌 몫을 지운다.
 *
 * 접기는 **id 상한을 먼저 정하고** 그 이하만 지운다 — 접는 사이에 도착한 업데이트를
 * `deleteMany({ noteId })`로 함께 지우면 그 편집이 영구히 사라진다. 접기가 다른 접기와
 * 겹쳐도 결과는 같다(같은 업데이트를 두 번 적용해도 CRDT는 수렴한다).
 */
async function compactIfNeeded(noteId: string): Promise<void> {
  const pending = await prisma.noteDocUpdate.count({ where: { noteId } });
  if (pending < COMPACT_THRESHOLD) return;

  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { content: true, docState: true },
  });
  if (!note) return;

  const updates = await prisma.noteDocUpdate.findMany({
    where: { noteId },
    orderBy: { id: 'asc' },
    select: { id: true, update: true },
  });
  if (updates.length === 0) return;
  // **읽은 id만** 지운다. id 상한(`lte`)으로 지우면 안 된다 — BIGSERIAL은 시퀀스를 INSERT
  // 시점에 뽑고 가시성은 커밋 시점에 생기므로, 우리가 읽는 동안 커밋되지 않은 더 낮은 id가
  // 있을 수 있다. 그걸 상한 아래라는 이유로 지우면 그 편집이 영구히 사라진다(규약 20 —
  // 시퀀스 값은 커밋 순서가 아니다. 스키마 주석의 'id가 곧 순서'는 틀린 전제였다).
  const foldedIds = updates.map((row) => row.id);

  const doc = new Y.Doc();
  Y.applyUpdate(doc, await ensureDocState(noteId, note));
  for (const row of updates) Y.applyUpdate(doc, new Uint8Array(row.update));

  await prisma.$transaction([
    prisma.note.update({
      where: { id: noteId },
      data: { docState: Buffer.from(Y.encodeStateAsUpdate(doc)) },
    }),
    prisma.noteDocUpdate.deleteMany({ where: { noteId, id: { in: foldedIds } } }),
  ]);
}

export type MaterializeOutcome = 'ok' | 'notfound' | 'unchanged';

/**
 * Yjs 상태를 화면·검색이 읽는 content로 구체화한다 — **KAN-38·71·72의 보장이 CRDT 경로로
 * 우회되지 않게 하는 자리다.**
 *
 * 편집 중의 진실은 Yjs이고 그 업데이트는 서버가 해석하지 않으므로, 저장 액션에 걸어 둔
 * zod 화이트리스트와 첨부 참조 동기화가 이 경로에는 걸리지 않는다. 그래서 완성된 문서를
 * 여기서 한 번 통과시킨다.
 *
 * 검증에 걸리면 **거부하지 않고 정규화한다**(KAN-72의 노선). 저장 액션은 사용자에게 오류를
 * 돌려줄 상대가 있지만 여기에는 없다 — 거부하면 content가 영원히 옛 상태로 굳고, 그 사이
 * 편집은 화면에서만 살아 있다가 사라진다. 스키마가 접을 수 있는 것(attr)은 zod가 접고,
 * 접을 수 없는 것(우리 라우트가 아닌 이미지 src)은 노드째 떨군다.
 */
export async function materializeNoteDoc(
  orgId: string,
  noteId: string,
  userId: string,
): Promise<MaterializeOutcome> {
  const snapshot = await loadNoteDoc(orgId, noteId);
  if (!snapshot) return 'notfound';

  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot.update);
  const raw = yDocToProsemirrorJSON(doc, NOTE_DOC_FIELD) as JSONContent;

  // 쓸 수 없는 첨부를 가리키는 이미지도 **미리 떨군다**. 남겨 두면 syncNoteAttachments가
  // 던져 트랜잭션째 롤백되고 content가 영원히 옛 값으로 굳는다 — 그 뒤의 정상 편집도 함께
  // 막힌다. 여기엔 오류를 돌려줄 상대가 없으니 거부는 곧 동결이다.
  const usable = await usableAttachmentIds(orgId, userId, noteId, collectNoteAttachmentIds(raw));
  const parsed = noteContentSchema.safeParse(sanitize(raw, usable));
  if (!parsed.success) {
    // 정규화까지 하고도 통과 못 하는 문서는 우리가 만든 적 없는 형태다 — content를 옛
    // 상태로 두는 편이 깨진 본문을 심는 것보다 낫다. 로그로 남겨 원인을 추적한다.
    console.error('[note-doc] 구체화 실패', { noteId, error: parsed.error.message });
    return 'unchanged';
  }
  const content = JSON.stringify(parsed.data);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.note.updateMany({
      where: { id: noteId, orgId, content: { not: content } },
      data: { content },
    });
    if (updated.count === 0) return 'unchanged';
    // 위에서 쓸 수 있는 것만 남겼으므로 이 호출은 던지지 않는다.
    await syncNoteAttachments(tx, orgId, userId, noteId, collectNoteAttachmentIds(parsed.data));
    return 'ok';
  });
}

/**
 * 이 문서가 참조하는 첨부 중 실제로 묶을 수 있는 것.
 *
 * 판정 근거는 저장 경로와 같다(usableNoteAttachmentWhere) — 다만 여기서는 '이 노트가 이미
 * 참조 중인 것'도 함께 살린다. 구체화를 트리거한 사람이 그 이미지를 넣은 사람이 아닐 수
 * 있어서다(A가 넣고 B의 편집이 구체화를 돌리는 것이 정상 경로다). 그 경우까지 거부하면
 * 이미 살아 있는 참조가 매 구체화마다 끊겼다 붙었다 한다.
 */
async function usableAttachmentIds(
  orgId: string,
  userId: string,
  noteId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.noteAttachment.findMany({
    where: {
      id: { in: ids },
      OR: [
        usableNoteAttachmentWhere(orgId, userId),
        { orgId, refs: { some: { noteId } } },
      ],
    },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * 이 노트의 Yjs 기반 상태를 돌려준다 — 없으면 content로 만들어 **저장한다**.
 *
 * 저장이 핵심이다. `prosemirrorJSONToYDoc`은 호출마다 새 client id로 **다른 CRDT 구조**를
 * 만든다(보이는 내용은 같아도 항목의 정체가 다르다). 매번 새로 만들면 앞선 편집 델타가
 * 가리키는 항목이 다음 시드에 없어 통합되지 못하고, 그 편집은 화면에서 조용히 사라진다.
 *
 * 두 요청이 동시에 처음 열면 각자 만든 시드가 갈라진다 — 그래서 조건부 update로 한쪽만
 * 이기게 하고, 진 쪽은 이긴 값을 다시 읽는다. 나중에 도착한 편집이 이긴 시드 위에서
 * 만들어져야 하므로 여기서 갈라지면 되돌릴 방법이 없다.
 */
async function ensureDocState(
  noteId: string,
  note: { content: string; docState: Uint8Array | null },
): Promise<Uint8Array> {
  if (note.docState) return new Uint8Array(note.docState);

  const seeded = new Y.Doc();
  // **화면이 읽는 것과 같은 파서를 쓴다**(규약 10). 별도 파서를 두었더니 legacy plain
  // 텍스트·스키마 밖 JSON을 null로 떨궈 빈 문서를 시드했고, 그 노트를 편집기로 여는 것만으로
  // 본문이 소멸했다(그리고 구체화가 빈 참조 목록으로 돌아 이미지까지 파기했다).
  const json = parseNoteContent(note.content);
  Y.applyUpdate(seeded, Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, json, NOTE_DOC_FIELD)));
  const state = Y.encodeStateAsUpdate(seeded);

  const claimed = await prisma.note.updateMany({
    where: { id: noteId, docState: null },
    data: { docState: Buffer.from(state) },
  });
  if (claimed.count === 1) return state;

  const winner = await prisma.note.findUnique({
    where: { id: noteId },
    select: { docState: true },
  });
  return winner?.docState ? new Uint8Array(winner.docState) : state;
}


/** 이 에디터 스키마가 아는 노드 타입 전부 — 화이트리스트의 근거를 스키마에서 가져온다. */
const ALLOWED_NODE_TYPES = new Set(Object.keys(schema.nodes));

/**
 * zod가 접을 수 없는 것을 미리 떨군다. 남겨 두면 문서 **전체**가 검증에 걸리고, 검증 실패는
 * 곧 content 동결이다(여기엔 사용자에게 오류를 돌려줄 상대가 없다).
 *
 * 처음에는 최상위 자식 중 `type === 'image'`인 것만 봤다. 그건 **한 인스턴스만 고치고 부류를
 * 닫았다고 선언한 것**이었고(규약 25), 리뷰가 세 갈래를 뚫었다: 허용된 이미지의 자식으로 심은
 * 이미지(재귀를 안 했다), image가 아닌 노드에 붙인 `src`, 스키마에 없는 노드 타입.
 * 그래서 근거를 스키마에서 가져와 전체를 훑는다 — 모르는 타입과 우리 라우트 밖 `src`는
 * 어디에 있든 떨군다.
 */
function sanitize(node: JSONContent, usable: Set<string>): JSONContent {
  const children = node.content?.flatMap((child) =>
    keep(child, usable) ? [sanitize(child, usable)] : [],
  );
  return children ? { ...node, content: children } : node;
}

function keep(node: JSONContent, usable: Set<string>): boolean {
  if (typeof node.type !== 'string' || !ALLOWED_NODE_TYPES.has(node.type)) return false;
  const src = node.attrs?.src;
  if (src === undefined || src === null) return true;
  if (typeof src !== 'string') return false;
  if (!src.startsWith(NOTE_ATTACHMENT_ROUTE) || !NOTE_ATTACHMENT_SRC_RE.test(src)) return false;
  return usable.has(src.slice(NOTE_ATTACHMENT_ROUTE.length));
}
