import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { prisma } from '@/server/db';
import { attachmentKeyPrefix, storage } from '@/server/storage';
import {
  CHANNEL_A,
  CHANNEL_B,
  ORG_A,
  USER_OTHER,
  USER_OWNER,
  resetDatabase,
  seedChannels,
  seedTenants,
} from '../../../test/db';
import { deleteChannel } from './channels';
import { deleteOrganization } from './clerk-sync';
import {
  PENDING_MAX_AGE_MS,
  PROCESS_GRACE_MS,
  processStorageCleanup,
  sweepAbandonedPending,
} from './storage-cleanup';

// 스토리지 정리 (KAN-70). setup-env의 더미 S3 env로 storage 모듈은 항상 켜져 있다 —
// 실제 네트워크로 나가지 않도록 send만 갈아 끼운다. 여기서 검증하는 것은 outbox 행의
// 수명(enqueue가 삭제와 원자인가, 실패가 남는가)과 스토리지에 보내는 명령의 인자다.
// 실제 MinIO에 오브젝트가 사라지는 것은 dev 런타임 검증 몫이다(attachments.test와 같은 분담).

if (!storage) {
  throw new Error('테스트에서는 storage가 켜져 있어야 한다 — test/setup-env.ts가 더미 env를 넣는다');
}
const BUCKET = storage.bucket;
const send = vi.fn();
// S3Client.send의 제네릭 오버로드는 목 함수 시그니처로 표현할 수 없다 — 테스트 경계의 단언.
storage.client.send = send as unknown as typeof storage.client.send;

/** 유예·기한을 지나게 만드는 시각 오프셋 — 행의 createdAt을 과거로 만들어 쓴다. */
const PAST_GRACE = () => new Date(Date.now() - PROCESS_GRACE_MS - 60_000);
const PAST_PENDING_AGE = () => new Date(Date.now() - PENDING_MAX_AGE_MS - 60_000);

let serial = 0;

async function createAttachment(opts: {
  orgId?: string;
  channelId?: string;
  messageId?: string;
  createdAt?: Date;
}): Promise<string> {
  const orgId = opts.orgId ?? ORG_A;
  serial += 1;
  const key = `${attachmentKeyPrefix(orgId)}test-${serial}`;
  await prisma.messageAttachment.create({
    data: {
      orgId,
      channelId: opts.channelId ?? CHANNEL_A,
      uploaderId: USER_OWNER,
      messageId: opts.messageId ?? null,
      key,
      fileName: '사진.png',
      contentType: 'image/png',
      size: 10,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
  return key;
}

async function createMessageRow(id: string, channelId: string, orgId: string, seq: number) {
  await prisma.chatMessage.create({
    data: { id, orgId, channelId, authorId: USER_OWNER, body: '본문', seq },
  });
}

async function outboxTargets(): Promise<{ kind: string; target: string }[]> {
  const rows = await prisma.storageCleanup.findMany({ orderBy: { target: 'asc' } });
  return rows.map((r) => ({ kind: r.kind, target: r.target }));
}

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
  await seedChannels();
  send.mockReset();
  send.mockResolvedValue({});
});

describe('sweepAbandonedPending — 버려진 pending 걷기', () => {
  it('기한 지난 pending만 걷어 키를 outbox로 옮긴다 — 신선한 pending과 바인딩된 첨부는 남는다', async () => {
    const stale = await createAttachment({ createdAt: PAST_PENDING_AGE() });
    await createAttachment({}); // 신선한 pending — 컴포저가 아직 쓰고 있을 수 있다
    await createMessageRow('msg_1', CHANNEL_A, ORG_A, 1);
    await createAttachment({ messageId: 'msg_1', createdAt: PAST_PENDING_AGE() }); // 오래됐지만 바인딩됨

    const swept = await sweepAbandonedPending();

    expect(swept).toBe(1);
    expect(await outboxTargets()).toEqual([{ kind: 'key', target: stale }]);
    expect(await prisma.messageAttachment.count()).toBe(2);
  });

  it('두 번 돌아도 결과가 같다', async () => {
    await createAttachment({ createdAt: PAST_PENDING_AGE() });
    await sweepAbandonedPending();
    const again = await sweepAbandonedPending();
    expect(again).toBe(0);
    expect(await prisma.storageCleanup.count()).toBe(1);
  });
});

describe('deleteOrganization — 조직 프리픽스 예약', () => {
  it('조직 파기와 같은 트랜잭션으로 프리픽스 정리를 예약한다', async () => {
    await createAttachment({});
    await deleteOrganization(ORG_A);

    expect(await prisma.organization.findUnique({ where: { id: ORG_A } })).toBeNull();
    // 행은 cascade로 사라졌지만 좌표(프리픽스)는 outbox에 남는다 — 그게 이 티켓이다.
    expect(await prisma.messageAttachment.count()).toBe(0);
    expect(await outboxTargets()).toEqual([
      { kind: 'prefix', target: attachmentKeyPrefix(ORG_A) },
    ]);
  });

  it('웹훅 재배달에 멱등하다', async () => {
    await deleteOrganization(ORG_A);
    await deleteOrganization(ORG_A);
    expect(await prisma.storageCleanup.count()).toBe(1);
  });
});

describe('deleteChannel — cascade 전에 키를 예약', () => {
  const CH_DEL = 'chan_a_del';

  beforeEach(async () => {
    await prisma.channel.create({
      data: { id: CH_DEL, orgId: ORG_A, name: '지울채널', createdById: USER_OWNER },
    });
  });

  it('그 채널의 첨부(pending·바인딩 모두) 키만 outbox로 옮긴다', async () => {
    const pendingKey = await createAttachment({ channelId: CH_DEL });
    await createMessageRow('msg_d', CH_DEL, ORG_A, 1);
    const boundKey = await createAttachment({ channelId: CH_DEL, messageId: 'msg_d' });
    await createAttachment({}); // 다른 채널(CHANNEL_A)의 첨부 — 남아야 한다

    const outcome = await deleteChannel(ORG_A, { userId: USER_OWNER, isAdmin: false }, CH_DEL);

    expect(outcome).toBe('ok');
    expect(await prisma.channel.findUnique({ where: { id: CH_DEL } })).toBeNull();
    const targets = (await outboxTargets()).map((t) => t.target);
    expect(targets.sort()).toEqual([boundKey, pendingKey].sort());
    expect(await prisma.messageAttachment.count()).toBe(1);
  });

  it('삭제가 거부되면 아무것도 예약하지 않는다 — 생성자 아님·기본 채널·남의 org', async () => {
    await createAttachment({ channelId: CH_DEL });

    expect(await deleteChannel(ORG_A, { userId: USER_OTHER, isAdmin: false }, CH_DEL)).toBe(
      'forbidden',
    );
    expect(await deleteChannel(ORG_A, { userId: USER_OWNER, isAdmin: false }, CHANNEL_A)).toBe(
      'default',
    );
    // 남의 워크스페이스의 채널 id를 알아도 매칭 자체가 안 된다(규약 1).
    expect(await deleteChannel(ORG_A, { userId: USER_OWNER, isAdmin: true }, CHANNEL_B)).toBe(
      'notfound',
    );

    expect(await prisma.storageCleanup.count()).toBe(0);
    expect(await prisma.channel.count()).toBe(3);
  });
});

describe('processStorageCleanup — outbox를 스토리지 삭제로', () => {
  async function enqueue(kind: string, target: string, createdAt: Date) {
    await prisma.storageCleanup.create({ data: { kind, target, createdAt } });
  }

  it('유예가 지난 key 행만 지우고 내린다 — 신선한 행은 업로드가 진행 중일 수 있다', async () => {
    await enqueue('key', 'org/org_a/att/old', PAST_GRACE());
    await enqueue('key', 'org/org_a/att/fresh', new Date());

    const result = await processStorageCleanup();

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({ Bucket: BUCKET, Key: 'org/org_a/att/old' });
    expect((await outboxTargets()).map((t) => t.target)).toEqual(['org/org_a/att/fresh']);
  });

  it('prefix 행은 목록이 빌 때까지 지운다', async () => {
    const prefix = attachmentKeyPrefix(ORG_A);
    await enqueue('prefix', prefix, PAST_GRACE());
    let listed = 0;
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        listed += 1;
        return listed === 1
          ? { Contents: [{ Key: `${prefix}1` }, { Key: `${prefix}2` }] }
          : { Contents: [] };
      }
      return {};
    });

    const result = await processStorageCleanup();

    expect(result).toEqual({ processed: 1, failed: 0 });
    const batch = send.mock.calls.find((c) => c[0] instanceof DeleteObjectsCommand)?.[0];
    expect(batch?.input.Delete?.Objects).toEqual([{ Key: `${prefix}1` }, { Key: `${prefix}2` }]);
    expect(await prisma.storageCleanup.count()).toBe(0);
  });

  it('실패한 행은 attempts를 올리고 남긴다 — 다음 실행이 다시 지운다', async () => {
    await enqueue('key', 'org/org_a/att/poison', PAST_GRACE());
    send.mockRejectedValueOnce(new Error('스토리지 응답 없음'));

    expect(await processStorageCleanup()).toEqual({ processed: 0, failed: 1 });
    const row = await prisma.storageCleanup.findUniqueOrThrow({
      where: { target: 'org/org_a/att/poison' },
    });
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('스토리지 응답 없음');

    // 행이 곧 재시도 예약이다 — 스토리지가 살아나면 다음 실행이 마저 지운다.
    expect(await processStorageCleanup()).toEqual({ processed: 1, failed: 0 });
    expect(await prisma.storageCleanup.count()).toBe(0);
  });

  it('실행 상한에 걸린 프리픽스는 실패가 아니라 미완이다 — 행을 남겨 다음 실행이 잇는다', async () => {
    await enqueue('prefix', attachmentKeyPrefix(ORG_A), PAST_GRACE());
    // 목록이 영원히 안 빈다 — 한 실행의 배치 상한(10)에 걸리는 상황.
    send.mockImplementation(async (command: unknown) =>
      command instanceof ListObjectsV2Command ? { Contents: [{ Key: 'org/org_a/att/x' }] } : {},
    );

    const result = await processStorageCleanup();

    expect(result).toEqual({ processed: 0, failed: 0 });
    const row = await prisma.storageCleanup.findFirstOrThrow();
    expect(row.attempts).toBe(0);
  });
});
