import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { ORG_A, ORG_B, USER_OTHER, USER_OWNER, resetDatabase, seedTenants } from '../../../test/db';
import { createMessage, listMessages } from './chat';

beforeEach(async () => {
  await resetDatabase();
  await seedTenants();
});

describe('멀티테넌시 격리', () => {
  it('listMessages는 자기 org의 메시지만 반환한다', async () => {
    await createMessage(ORG_A, USER_OWNER, 'A의 메시지');
    await createMessage(ORG_B, USER_OTHER, 'B의 메시지');

    expect((await listMessages(ORG_A)).map((m) => m.body)).toEqual(['A의 메시지']);
    expect((await listMessages(ORG_B)).map((m) => m.body)).toEqual(['B의 메시지']);
  });

  it('오래된 것부터 시간순으로 반환한다', async () => {
    await createMessage(ORG_A, USER_OWNER, '첫 번째');
    await createMessage(ORG_A, USER_OWNER, '두 번째');
    await createMessage(ORG_A, USER_OWNER, '세 번째');

    expect((await listMessages(ORG_A)).map((m) => m.body)).toEqual([
      '첫 번째',
      '두 번째',
      '세 번째',
    ]);
  });
});

describe('작성자 표시', () => {
  it('미러에 사용자가 있으면 이름을, 없으면 id를 쓴다', async () => {
    await prisma.user.update({
      where: { id: USER_OWNER },
      data: { firstName: '단', lastName: '강' },
    });
    await createMessage(ORG_A, USER_OWNER, '이름 있는 사람');
    // 웹훅이 아직 안 온 사용자 — 미러 행이 없다.
    await createMessage(ORG_A, 'user_not_mirrored_yet', '아직 동기화 전');

    const [named, unnamed] = await listMessages(ORG_A);
    expect(named.authorName).toBe('단 강');
    expect(unnamed.authorName).toBe('user_not_mirrored_yet');
  });
});

describe('테넌트 수명 (KAN-19)', () => {
  it('조직을 지우면 그 조직의 메시지도 함께 파기된다', async () => {
    await createMessage(ORG_A, USER_OWNER, 'A-1');
    await createMessage(ORG_A, USER_OWNER, 'A-2');
    await createMessage(ORG_B, USER_OTHER, 'B-1');

    await prisma.organization.delete({ where: { id: ORG_A } });

    expect(await prisma.chatMessage.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.chatMessage.count({ where: { orgId: ORG_B } })).toBe(1);
  });

  it('삭제된 org로는 전송할 수 없고, org 스켈레톤도 부활하지 않는다', async () => {
    await prisma.organization.delete({ where: { id: ORG_A } });
    await prisma.clerkTombstone.create({ data: { id: ORG_A } });

    await expect(createMessage(ORG_A, USER_OWNER, '유령 메시지')).rejects.toThrow();

    expect(await prisma.organization.count({ where: { id: ORG_A } })).toBe(0);
    expect(await prisma.chatMessage.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('삭제된 사용자로는 전송할 수 없다', async () => {
    await prisma.user.delete({ where: { id: USER_OWNER } });
    await prisma.clerkTombstone.create({ data: { id: USER_OWNER } });

    await expect(createMessage(ORG_A, USER_OWNER, '유령이 보낸 말')).rejects.toThrow();

    expect(await prisma.chatMessage.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('org 미러가 아직 없어도 전송된다 (웹훅 지연 경합)', async () => {
    await prisma.organization.deleteMany({});

    const message = await createMessage(ORG_A, USER_OWNER, '부트스트랩');

    expect(message.body).toBe('부트스트랩');
    expect(await prisma.organization.count({ where: { id: ORG_A } })).toBe(1);
  });
});
