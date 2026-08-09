import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/server/db';
import {
  ORG_A,
  ORG_B,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedTenants,
} from '../../../../../test/db';
import { noteDocChannel, notePresenceChannel } from '@/features/notes/realtime';

// 세션과 Pusher 서명만 대역이다 — 둘 다 HTTP로는 만들 수 없다(Clerk 세션·앱 시크릿).
// 접근 판정과 DB는 실물이라, 이 파일이 고정하는 것은 '누가 어느 채널을 열 수 있는가'다.
const authState = vi.fn();
const viewerIdentity = vi.fn();
vi.mock('@/server/auth', () => ({
  getAuthState: () => authState(),
  getViewerIdentity: () => viewerIdentity(),
}));

// authorizeChannel은 받은 인자를 그대로 돌려준다 — 서명값이 아니라 **무엇을 서명했는지**가
// 이 테스트의 관심사다(특히 presence의 user_id·user_info).
const authorizeChannel = vi.fn((socketId: string, channel: string, presence?: unknown) => ({
  socketId,
  channel,
  presence,
}));
vi.mock('@/server/pusher', () => ({ pusherServer: { authorizeChannel } }));

const { POST } = await import('./route');

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
  authState.mockResolvedValue({ userId: USER_OWNER, orgId: ORG_A });
  viewerIdentity.mockResolvedValue({ id: USER_OWNER, name: '단 강', imageUrl: 'https://img/1.png' });
  authorizeChannel.mockClear();
});

/** pusher-js가 보내는 모양 그대로 — form-urlencoded다. */
function authRequest(channel: string, socketId = '123.456'): Request {
  const form = new URLSearchParams({ socket_id: socketId, channel_name: channel });
  return new Request('http://localhost/api/pusher/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

async function noteIn(orgId: string): Promise<string> {
  const note = await prisma.note.create({
    data: { orgId, authorId: USER_OWNER, title: '문서' },
  });
  return note.id;
}

describe('문서 채널 인증 (KAN-75)', () => {
  it('세션이 없으면 401 — 채널 종류를 보기도 전에', async () => {
    authState.mockResolvedValue({ userId: null, orgId: null });

    expect((await POST(authRequest(notePresenceChannel('x')))).status).toBe(401);
  });

  it('내 워크스페이스 문서의 커서 채널은 서명한다', async () => {
    const noteId = await noteIn(ORG_A);

    const response = await POST(authRequest(notePresenceChannel(noteId)));

    expect(response.status).toBe(200);
    expect(authorizeChannel).toHaveBeenCalledWith(
      '123.456',
      notePresenceChannel(noteId),
      expect.objectContaining({ user_id: USER_OWNER }),
    );
  });

  it('남의 워크스페이스 문서와 없는 문서가 똑같이 403 — 존재 오라클이 없다', async () => {
    const foreign = await noteIn(ORG_B);

    const denied = await POST(authRequest(notePresenceChannel(foreign)));
    const missing = await POST(authRequest(notePresenceChannel('does-not-exist')));

    expect(denied.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await denied.text()).toBe(await missing.text());
    expect(authorizeChannel).not.toHaveBeenCalled();
  });

  it('커서 채널과 문서 채널의 판정이 갈리지 않는다 (규약 22)', async () => {
    // 여기가 느슨해지면 한쪽 경로만 열린 채로 남는다 — 본문은 못 보는데 커서는 보이거나,
    // 그 반대가 된다. 같은 noteId에 대해 두 채널이 늘 같은 답을 내야 한다.
    const mine = await noteIn(ORG_A);
    const foreign = await noteIn(ORG_B);

    for (const noteId of [mine, foreign, 'does-not-exist']) {
      const doc = await POST(authRequest(noteDocChannel(noteId)));
      const presence = await POST(authRequest(notePresenceChannel(noteId)));

      expect(presence.status).toBe(doc.status);
    }
  });

  it('멤버가 아니어도 같은 org면 열린다 — 노트는 org 전체 공개다', async () => {
    const noteId = await noteIn(ORG_A);
    authState.mockResolvedValue({ userId: USER_OTHER, orgId: ORG_A });
    viewerIdentity.mockResolvedValue({ id: USER_OTHER, name: '홍 길동', imageUrl: null });

    expect((await POST(authRequest(notePresenceChannel(noteId)))).status).toBe(200);
  });
});

describe('커서 이름표의 출처 (KAN-75)', () => {
  it('이름은 세션에서 온다 — 이게 awareness 페이로드를 믿지 않아도 되는 근거다', async () => {
    const noteId = await noteIn(ORG_A);

    await POST(authRequest(notePresenceChannel(noteId)));

    expect(authorizeChannel).toHaveBeenCalledWith(
      '123.456',
      notePresenceChannel(noteId),
      expect.objectContaining({
        user_id: USER_OWNER,
        user_info: { name: '단 강', imageUrl: 'https://img/1.png' },
      }),
    );
  });

  it('Clerk 조회가 실패해도 접속 자체는 성립한다 — 이름만 id로 떨어진다', async () => {
    const noteId = await noteIn(ORG_A);
    viewerIdentity.mockResolvedValue(null);

    const response = await POST(authRequest(notePresenceChannel(noteId)));

    expect(response.status).toBe(200);
    expect(authorizeChannel).toHaveBeenCalledWith(
      '123.456',
      notePresenceChannel(noteId),
      expect.objectContaining({ user_id: USER_OWNER, user_info: { name: USER_OWNER, imageUrl: null } }),
    );
  });

  it('문서 채널은 presence 데이터 없이 서명한다 — private 채널에는 명단이 없다', async () => {
    const noteId = await noteIn(ORG_A);

    await POST(authRequest(noteDocChannel(noteId)));

    expect(authorizeChannel).toHaveBeenCalledWith('123.456', noteDocChannel(noteId), undefined);
  });
});
