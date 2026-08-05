import 'server-only';

import { prisma } from '@/server/db';
import { Prisma } from '@/server/generated/prisma/client';
import { visibleWhere } from '@/server/services/channels';

/** 채널 id → 안읽음 수. 0인 채널은 아예 안 담는다. */
export type UnreadMap = Map<string, number>;

/**
 * 내가 참여한 채널들의 안읽음 수 (KAN-33, 형태는 KAN-56).
 *
 * 참여하지 않은 공개 채널('둘러보기')은 세지 않는다 — 들어가 본 적도 없는 채널의 뱃지는
 * 신호가 아니라 소음이고, 기준선으로 삼을 참여 행조차 없다.
 *
 * 채널마다 기준선이 달라, (채널, 기준선)을 **VALUES 목록으로 넘기고 채널마다 스칼라
 * 서브쿼리**로 센다. 이전 형태(기준선 조건을 OR로 묶은 groupBy 한 번)를 버린 이유는
 * 실측이다(KAN-56): Bitmap Heap Scan의 Recheck가 후보 행마다 OR 가지 **전체**를 다시
 * 평가해 비용이 가지 수 × 매칭 행 수로 자랐고, 300가지부터는 total_cost가
 * jit_above_cost를 넘겨 매 실행 JIT 컴파일이 절벽을 만들었다(Prisma가 파라미터 수가
 * 다른 SQL 텍스트를 매번 보내 plan cache도 안 걸린다). 500채널 × 10만행에서
 * 1235ms → 49ms. 서브쿼리 형태는 채널마다 (channelId, seq) 유니크 인덱스의 시작
 * 경계로 들어가므로 채널 수에 선형이고, 행 수와는 무관하다.
 *
 * **안읽음의 정의가 이제 이 WHERE 절이다** — 답글은 세지 않고(parentId IS NULL — 채널
 * 본문에 안 보이므로 뱃지를 눌러 가도 찾을 수 없고, 스레드에서 불렸다면 알림 센터가
 * 맡는다), 내가 쓴 메시지도 세지 않는다(authorId <>). 클라이언트의 실시간 판정
 * (use-channel-unread의 onMessage)이 이 정의의 쌍둥이고, 테스트가 채널별 단순 카운트와의
 * 동등성을 고정한다. raw SQL의 식별자는 전부 상수 문자열, 값은 전부 파라미터다
 * (Prisma.sql 템플릿이 바인딩한다).
 *
 * 기준선이 순번 하나로 정리된 것은 KAN-55다. 시각 두 종류(참여 시각 · 커서 시각)를
 * 비교하던 시절에는 그 둘이 서로 다른 앱 프로세스의 시계였고, 같은 ms 동률을 가르는
 * 보조 키 규칙도 가지마다 달랐다. 같은 채널의 순번끼리는 그냥 큰 쪽이 뒤다.
 */
export async function unreadCounts(orgId: string, userId: string): Promise<UnreadMap> {
  const [memberships, cursors] = await Promise.all([
    prisma.channelMember.findMany({
      // 참여 행만으로도 채널은 좁혀지지만, 테넌트 조회에는 예외 없이 orgId를 싣는다.
      where: { userId, channel: { orgId } },
      select: { channelId: true, joinedSeq: true },
    }),
    prisma.channelRead.findMany({
      where: { userId, orgId },
      select: { channelId: true, lastReadSeq: true },
    }),
  ]);
  if (memberships.length === 0) {
    return new Map();
  }

  const cursorByChannel = new Map(cursors.map((row) => [row.channelId, row.lastReadSeq]));
  const baselines = memberships.map(({ channelId, joinedSeq }) => {
    // 둘 중 큰 쪽이 기준선이다. 커서가 참여 기준선보다 뒤일 때만 이기는 것은 재참여 때문이다
    // — 나갔다 들어오면 옛 커서가 남아 있는데(leaveChannel은 참여 행만 지운다), 그걸 그대로
    // 믿으면 내가 없던 동안의 대화가 통째로 안읽음으로 되살아난다.
    const baseline = Math.max(joinedSeq, cursorByChannel.get(channelId) ?? 0);
    return Prisma.sql`(${channelId}::text, ${baseline}::int4)`;
  });

  // baseline은 int4로 고정 캐스팅한다 — VALUES의 타입 추론이 첫 행에 좌우되는 것을 막는다.
  // 서브쿼리의 orgId 조건은 논리적으로 중복이지만(참여 행이 이미 이 org의 채널이다)
  // '테넌트 조회에는 예외 없이 orgId' 규칙을 raw SQL에서만 비우지 않는다.
  const rows = await prisma.$queryRaw<{ channelId: string; unread: number }[]>(Prisma.sql`
    SELECT b."channelId",
           (SELECT count(*)::int FROM "ChatMessage" m
             WHERE m."channelId" = b."channelId"
               AND m."seq" > b."baseline"
               AND m."orgId" = ${orgId}
               AND m."parentId" IS NULL
               AND m."authorId" <> ${userId}) AS unread
    FROM (VALUES ${Prisma.join(baselines)}) AS b("channelId", "baseline")
  `);
  // 0인 채널은 담지 않는다 — groupBy 시절의 계약 그대로다(호출부가 '없으면 0'으로 읽는다).
  return new Map(rows.filter((row) => row.unread > 0).map((row) => [row.channelId, row.unread]));
}

/**
 * 읽음 커서를 이 메시지까지 올린다 (KAN-33).
 *
 * 접근할 수 없는 채널이거나 그 채널의 메시지가 아니면 false — 남의 채널 id로 내 커서를
 * 만들어 두는 경로를 막는다(그 자체로 위험하진 않지만 존재하지 않아야 할 행이다).
 *
 * **커서는 뒤로 가지 않는다.** 사용자가 위로 올려 옛 메시지를 보는 동안에도 요청이 나갈
 * 수 있고, 여러 탭·느린 응답이 섞이면 순서가 뒤집힌다. 뒤로 물러난 커서는 이미 읽은 것을
 * 안읽음으로 되살려 뱃지가 유령처럼 다시 뜬다.
 */
export async function markChannelRead(
  orgId: string,
  userId: string,
  channelId: string,
  messageId: string,
): Promise<boolean> {
  const message = await prisma.chatMessage.findFirst({
    where: {
      id: messageId,
      channelId,
      orgId,
      // parentId: null — 커서가 가리킬 수 있는 것은 채널 본문에 뜨는 메시지뿐이다
      // (unreadCounts가 세는 것과 같은 집합). 답글도 같은 채널 카운터에서 순번을 받으므로
      // 답글 id로 커서를 세우면 아직 안 읽은 루트 메시지들을 건너뛰어 버린다.
      parentId: null,
      // 참여한 채널만. unreadCounts가 참여 채널만 세므로, 그렇지 않으면 둘러보기만 한
      // 채널마다 아무도 안 읽는 커서 행이 쌓인다(두 함수의 대상 집합을 맞춘다).
      channel: { ...visibleWhere(orgId, userId), members: { some: { userId } } },
    },
    select: { id: true, seq: true },
  });
  if (!message) {
    return false;
  }

  // 먼저 '더 앞으로 가는 경우'만 갱신해 본다. where에 전진 조건을 실었으므로 동시에 들어온
  // 옛 커서는 매칭 자체가 안 된다 — 읽고 비교하는 방식과 달리 경합이 생기지 않는다.
  const advance = () =>
    prisma.channelRead.updateMany({
      where: { channelId, userId, orgId, lastReadSeq: { lt: message.seq } },
      data: { lastReadSeq: message.seq },
    });

  if ((await advance()).count > 0) {
    return true;
  }

  // 갱신되지 않은 이유는 둘이다: 행이 없거나(첫 읽음), 이미 더 앞서 있거나.
  // 전자만 만든다 — createMany + skipDuplicates라 동시 첫 읽음에도 유니크 위반으로 죽지 않는다.
  const created = await prisma.channelRead.createMany({
    data: [{ channelId, userId, orgId, lastReadSeq: message.seq }],
    skipDuplicates: true,
  });
  if (created.count === 0) {
    // 방금 다른 요청이 첫 행을 만들었다. 그게 나보다 옛 메시지였다면 내 전진이 통째로
    // 사라지므로(skipDuplicates는 조용히 넘어간다) 한 번 더 밀어 본다. 이미 더 앞서
    // 있으면 where가 매칭되지 않아 아무 일도 일어나지 않는다.
    await advance();
  }
  return true;
}
