import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  CHANNEL_A,
  CHANNEL_B,
  ORG_A,
  ORG_B,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedChannels,
  seedTenants,
} from '../../../test/db';
import { createPendingAttachment, resolveDownloadUrl } from './attachments';
import { createMessage, listMessages } from './chat';

// 첨부 (KAN-35). presign은 오프라인 서명이라 실제 스토리지 없이 돈다(setup-env.ts의 더미
// env) — 여기서 검증하는 것은 행·소유·바인딩·수명, 즉 깨지면 보안 사고인 DB 쪽 전부다.
// 실제 바이트가 오가는 경로(정책의 크기·타입 거부 포함)는 dev 런타임 검증 몫이다.

const PRIVATE_A = 'chan_a_private';
// presigned URL에서 '무엇으로 내려보내는가'를 보는 유일한 자리. 그냥 'attachment'를 찾으면
// **버킷 이름**(dankangnote-attachments / test-attachments)에 걸려 무엇을 서명하든 통과하는
// 공허한 어서션이 된다 — forcePathStyle이라 버킷이 항상 경로에 있다 (KAN-72).
const DISPOSITION = 'response-content-disposition=';

const FILE = { fileName: '보고서.pdf', contentType: 'application/pdf', size: 1234 };
const IMAGE = { fileName: '사진.png', contentType: 'image/png', size: 2048 };

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
  await seedChannels();
  // ORG_A의 비공개 채널 — 참여자는 USER_OWNER뿐이다.
  await prisma.channel.create({
    data: {
      id: PRIVATE_A,
      orgId: ORG_A,
      name: '비밀',
      isPrivate: true,
      members: { create: [{ userId: USER_OWNER }] },
    },
  });
});

/** presign이 성공했다는 전제로 attachment id만 뽑는다 — 바인딩 테스트의 준비 단계. */
async function presign(
  orgId: string,
  userId: string,
  channelId: string,
  input = FILE,
): Promise<string> {
  const outcome = await createPendingAttachment(orgId, userId, channelId, input);
  if (outcome.status !== 'ok') {
    throw new Error(`presign 실패: ${outcome.status}`);
  }
  return outcome.attachment.id;
}

describe('createPendingAttachment — 업로드 자리', () => {
  it('접근할 수 있는 채널이면 pending 행과 업로드 티켓을 만든다', async () => {
    const outcome = await createPendingAttachment(ORG_A, USER_OWNER, CHANNEL_A, FILE);
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    // 업로드 티켓 — 스토리지 직접 업로드에 필요한 전부. Content-Type이 정책 필드로 고정된다.
    expect(outcome.upload.url).toContain('http');
    expect(outcome.upload.fields['Content-Type']).toBe('application/pdf');

    const row = await prisma.messageAttachment.findUniqueOrThrow({
      where: { id: outcome.attachment.id },
    });
    expect(row).toMatchObject({
      orgId: ORG_A,
      channelId: CHANNEL_A,
      uploaderId: USER_OWNER,
      messageId: null,
      fileName: '보고서.pdf',
      size: 1234,
    });
    // 키는 테넌트 프리픽스 아래에 있고 파일명을 포함하지 않는다(스키마 주석의 정리 전제).
    expect(row.key.startsWith(`org/${ORG_A}/att/`)).toBe(true);
    expect(row.key).not.toContain('보고서');
  });

  it('남의 워크스페이스 채널에는 자리를 내주지 않는다', async () => {
    const outcome = await createPendingAttachment(ORG_A, USER_OWNER, CHANNEL_B, FILE);
    expect(outcome.status).toBe('notfound');
    expect(await prisma.messageAttachment.count()).toBe(0);
  });

  it('참여하지 않은 비공개 채널에도 자리를 내주지 않는다', async () => {
    const outcome = await createPendingAttachment(ORG_A, USER_OTHER, PRIVATE_A, FILE);
    expect(outcome.status).toBe('notfound');
  });

  it('삭제된 사용자(tombstone)의 업로드는 거부된다', async () => {
    await prisma.clerkTombstone.create({ data: { id: USER_OWNER } });
    await expect(createPendingAttachment(ORG_A, USER_OWNER, CHANNEL_A, FILE)).rejects.toThrow();
    expect(await prisma.messageAttachment.count()).toBe(0);
  });
});

describe('createMessage 바인딩 — 소유 검증은 where 하나다', () => {
  it('내 pending 첨부를 바인딩하고 뷰·목록에 싣는다 (첨부만·빈 본문 포함)', async () => {
    const first = await presign(ORG_A, USER_OWNER, CHANNEL_A, IMAGE);
    const second = await presign(ORG_A, USER_OWNER, CHANNEL_A, FILE);

    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '', undefined, [], [
      first,
      second,
    ]);
    expect(sent).not.toBeNull();
    // 업로드(선택) 순서 그대로 실린다.
    expect(sent?.message.attachments.map((attachment) => attachment.id)).toEqual([first, second]);
    expect(sent?.message.body).toBe('');

    const rows = await prisma.messageAttachment.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((row) => row.messageId)).toEqual([sent?.message.id, sent?.message.id]);

    // 조회 경로에도 붙는다.
    const page = await listMessages(ORG_A, USER_OWNER, CHANNEL_A);
    expect(page.messages[0].attachments.map((attachment) => attachment.fileName)).toEqual([
      '사진.png',
      '보고서.pdf',
    ]);
  });

  it('남의 첨부 id를 실으면 전송 자체가 롤백된다', async () => {
    const others = await presign(ORG_A, USER_OTHER, CHANNEL_A, FILE);

    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '가로채기', undefined, [], [
      others,
    ]);
    expect(sent).toBeNull();
    // 메시지도, 바인딩도 없다 — 트랜잭션이 통째로 되돌아갔다.
    expect(await prisma.chatMessage.count()).toBe(0);
    const row = await prisma.messageAttachment.findUniqueOrThrow({ where: { id: others } });
    expect(row.messageId).toBeNull();
    // 순번 증가까지 함께 되돌아간다 — 다음 정상 전송이 1번을 받는다.
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: CHANNEL_A } });
    expect(channel.messageSeq).toBe(0);
  });

  it('접근 가능한 다른 채널에 올린 첨부도 거부된다 — 채널까지 일치해야 한다', async () => {
    const forPrivate = await presign(ORG_A, USER_OWNER, PRIVATE_A, FILE);
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '채널 섞기', undefined, [], [
      forPrivate,
    ]);
    expect(sent).toBeNull();
  });

  it('이미 바인딩된 첨부는 다시 쓸 수 없다', async () => {
    const id = await presign(ORG_A, USER_OWNER, CHANNEL_A, FILE);
    const firstSend = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '첫 전송', undefined, [], [
      id,
    ]);
    expect(firstSend).not.toBeNull();

    const secondSend = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '재사용', undefined, [], [
      id,
    ]);
    expect(secondSend).toBeNull();
    // 원래 바인딩은 그대로다.
    const row = await prisma.messageAttachment.findUniqueOrThrow({ where: { id } });
    expect(row.messageId).toBe(firstSend?.message.id);
  });

  it('없는 첨부 id도 같은 실패다(존재 오라클 없음)', async () => {
    const sent = await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '유령 첨부', undefined, [], [
      'att_ghost',
    ]);
    expect(sent).toBeNull();
  });
});

describe('resolveDownloadUrl — 접근 판정', () => {
  /** 바인딩까지 끝난 첨부 하나를 만든다. */
  async function bound(channelId: string, input = IMAGE): Promise<string> {
    const id = await presign(ORG_A, USER_OWNER, channelId, input);
    const sent = await createMessage(ORG_A, USER_OWNER, channelId, '첨부', undefined, [], [id]);
    if (!sent) throw new Error('전송 실패');
    return id;
  }

  it('공개 채널의 바인딩된 첨부는 조직 멤버가 볼 수 있다', async () => {
    const id = await bound(CHANNEL_A);
    const url = await resolveDownloadUrl(ORG_A, USER_OTHER, id, false);
    expect(url).not.toBeNull();
    // 안전한 이미지 타입은 inline으로 서빙된다.
    expect(url).toContain(`${DISPOSITION}inline`);
  });

  it('비공개 채널의 첨부는 참여자만 — 남의 워크스페이스는 아예 없다', async () => {
    const id = await bound(PRIVATE_A);
    expect(await resolveDownloadUrl(ORG_A, USER_OWNER, id, false)).not.toBeNull();
    expect(await resolveDownloadUrl(ORG_A, USER_OTHER, id, false)).toBeNull();
    expect(await resolveDownloadUrl(ORG_B, USER_OTHER, id, false)).toBeNull();
  });

  it('pending 첨부는 업로더 본인만 본다 — 낙관 말풍선 경로', async () => {
    const id = await presign(ORG_A, USER_OWNER, CHANNEL_A, IMAGE);
    expect(await resolveDownloadUrl(ORG_A, USER_OWNER, id, false)).not.toBeNull();
    expect(await resolveDownloadUrl(ORG_A, USER_OTHER, id, false)).toBeNull();
  });

  it('이미지가 아닌 타입과 download 강제는 attachment로 내린다', async () => {
    const pdf = await bound(CHANNEL_A, FILE);
    expect(await resolveDownloadUrl(ORG_A, USER_OWNER, pdf, false)).toContain(`${DISPOSITION}attachment`);

    const image = await presign(ORG_A, USER_OWNER, CHANNEL_A, IMAGE);
    expect(await resolveDownloadUrl(ORG_A, USER_OWNER, image, true)).toContain(`${DISPOSITION}attachment`);
  });
});

describe('수명 — 행은 테넌트와 함께 사라진다', () => {
  it('조직 삭제가 바인딩·pending 행을 모두 파기한다 (cascade)', async () => {
    await bound_();
    await presign(ORG_A, USER_OWNER, CHANNEL_A, FILE);
    expect(await prisma.messageAttachment.count()).toBe(2);

    await prisma.organization.delete({ where: { id: ORG_A } });
    expect(await prisma.messageAttachment.count()).toBe(0);
  });

  it('채널 삭제도 그 채널의 pending 행을 파기한다', async () => {
    await presign(ORG_A, USER_OWNER, PRIVATE_A, FILE);
    await prisma.channel.delete({ where: { id: PRIVATE_A } });
    expect(await prisma.messageAttachment.count()).toBe(0);
  });

  async function bound_(): Promise<void> {
    const id = await presign(ORG_A, USER_OWNER, CHANNEL_A, IMAGE);
    await createMessage(ORG_A, USER_OWNER, CHANNEL_A, '첨부', undefined, [], [id]);
  }
});
