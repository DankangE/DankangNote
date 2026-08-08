import { getAuthState } from '@/server/auth';
import { pusherServer } from '@/server/pusher';
import { allowOnceEvery } from '@/server/services/rate-limit';
import {
  appendNoteDocUpdate,
  loadNoteDoc,
  materializeNoteDoc,
} from '@/server/services/note-doc';
import {
  MAX_BROADCAST_UPDATE_BYTES,
  MAX_DOC_UPDATE_BYTES,
  NOTE_DOC_RESYNC_EVENT,
  NOTE_DOC_UPDATE_EVENT,
  noteDocChannel,
} from '@/features/notes/realtime';

/**
 * 실시간 공동 편집의 전송 계층 (KAN-39).
 *
 * **Server Action이 아니라 Route Handler다** — 액션은 한 줄로 직렬화돼 순서대로 처리되므로,
 * 글자를 치는 내내 나가는 이 업데이트를 액션으로 두면 같은 화면의 다른 액션이 전부 그만큼
 * 밀린다(타이핑 핑·이력 조회와 같은 이유, KAN-34).
 *
 * 판정은 우리가 한다 — Pusher 클라이언트 이벤트를 쓰면 서버를 건너뛰어 더 빠르지만,
 * 그러면 '이 문서를 편집할 수 있는가'를 물을 자리도 '무엇을 저장할 것인가'도 사라진다.
 */

/** 구체화(content 반영) 최소 간격. 매 타건마다 돌릴 수 없다 — 문서 전체를 다시 만든다. */
const MATERIALIZE_INTERVAL_MS = 5_000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const { userId, orgId } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { noteId } = await params;
  const snapshot = await loadNoteDoc(orgId, noteId);
  // 없는 노트와 남의 org 노트가 같은 404다(존재 오라클 방지 — 첨부 라우트와 같은 규칙).
  if (!snapshot) {
    return new Response('Not Found', { status: 404 });
  }

  return Response.json(
    {
      version: snapshot.version.toString(),
      update: Buffer.from(snapshot.update).toString('base64'),
    },
    // 문서 상태는 매 요청 달라진다 — 캐시에 남으면 남의 편집을 잃은 채로 시작한다.
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const { userId, orgId } = await getAuthState();
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isUpdateBody(body)) {
    return new Response('Bad Request', { status: 400 });
  }
  const update = Buffer.from(body.update, 'base64');
  // base64는 잘못된 문자를 조용히 버리므로 길이로 되짚는다 — 빈 델타는 보낼 이유가 없다.
  if (update.length === 0 || update.length > MAX_DOC_UPDATE_BYTES) {
    return new Response('Bad Request', { status: 400 });
  }

  const { noteId } = await params;
  const version = await appendNoteDocUpdate(orgId, noteId, update);
  if (version === null) {
    return new Response('Not Found', { status: 404 });
  }

  await broadcast(noteId, body);
  await materializeIfDue(orgId, noteId, userId);

  return Response.json({ version: version.toString() });
}

/**
 * 같은 문서를 열어 둔 다른 편집자에게 델타를 흘린다. 보낸 사람은 제외한다(socketId) —
 * 자기 편집을 되받으면 무해하지만(CRDT는 멱등) 왕복마다 쓸데없이 문서를 다시 만진다.
 *
 * 상한을 넘는 델타는 **쪼개지 않고** 재동기화 신호로 대체한다. 쪼개면 순서·유실 처리를
 * 전송 계층에서 다시 떠안게 되는데, 그건 CRDT가 이미 푼 문제다.
 */
async function broadcast(
  noteId: string,
  body: { update: string; socketId?: string },
): Promise<void> {
  if (!pusherServer) return;
  const channel = noteDocChannel(noteId);
  const options = body.socketId ? { socket_id: body.socketId } : undefined;
  try {
    if (body.update.length <= MAX_BROADCAST_UPDATE_BYTES) {
      await pusherServer.trigger(channel, NOTE_DOC_UPDATE_EVENT, { update: body.update }, options);
    } else {
      await pusherServer.trigger(channel, NOTE_DOC_RESYNC_EVENT, {}, options);
    }
  } catch (error) {
    // 브로드캐스트 실패는 저장을 되돌릴 이유가 아니다 — 편집은 이미 남았고, 다른 편집자는
    // 다음 업데이트나 재접속 때 따라잡는다. 조용히 삼키지는 않는다.
    console.error('[note-doc] 브로드캐스트 실패', { noteId, error });
  }
}

/**
 * 화면·검색이 읽는 content로 접는다. 매 업데이트마다 돌리면 문서 전체를 그때마다 다시
 * 만들게 되므로 간격을 둔다 — 그동안 content는 몇 초 뒤처지고, 그건 의도된 지연이다.
 *
 * 리밋 키가 (사용자, 노트)라 편집자 수만큼 더 자주 돌 수 있다. 구체화는 멱등이라 해로울
 * 것이 없고, 반대로 노트 단위 전역 키로 두면 한 사람의 편집이 남의 리밋을 소모한다.
 */
async function materializeIfDue(orgId: string, noteId: string, userId: string): Promise<void> {
  // 실존 검증(appendNoteDocUpdate) **뒤**에 키를 조립한다 — 요청이 실어 온 문자열로 키를
  // 만들면 스프레이가 리밋 표에 행을 무한히 만든다(rate-limit.ts 주석).
  if (!(await allowOnceEvery(MATERIALIZE_INTERVAL_MS, userId, `notedoc:${noteId}`))) return;
  try {
    await materializeNoteDoc(orgId, noteId, userId);
  } catch (error) {
    // 구체화 실패가 편집 저장을 되돌리면 안 된다 — 업데이트는 이미 로그에 남았고 다음
    // 회차가 다시 시도한다.
    console.error('[note-doc] 구체화 실패', { noteId, error });
  }
}

function isUpdateBody(value: unknown): value is { update: string; socketId?: string } {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as { update?: unknown; socketId?: unknown };
  return (
    typeof body.update === 'string' &&
    (body.socketId === undefined || typeof body.socketId === 'string')
  );
}
