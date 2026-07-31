import 'server-only';

import { prisma } from '@/server/db';
import type { Prisma, User } from '@/server/generated/prisma/client';
import { visibleWhere } from '@/server/services/channels';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { userSkeleton } from '@/server/services/skeleton';
import { displayName } from '@/server/services/user-display';
import { REACTION_EMOJIS } from '@/features/chat/reactions';
import type { ChatMessageView, ReactionDelta, ReactionView } from '@/features/chat/types';

type MessageRow = Prisma.ChatMessageGetPayload<object>;

// 작성자 표시는 Clerk 미러 User에서 읽는다 — webhook 동기화 전이면 id로 대체.
// ChatMessage.authorId에 FK를 안 두는 이유이기도 하다(전송이 동기화 순서에 안 묶이게).
function toView(
  message: MessageRow,
  author: User | null,
  replyCount: number,
  reactions: ReactionView[],
): ChatMessageView {
  return {
    id: message.id,
    channelId: message.channelId,
    parentId: message.parentId,
    authorId: message.authorId,
    authorName: author ? displayName(author) : message.authorId,
    authorImageUrl: author?.imageUrl ?? null,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    replyCount,
    reactions,
  };
}

/**
 * 이 메시지들의 리액션을 이모지별로 접는다 (KAN-31).
 *
 * 쿼리 두 개로 나눈 이유: 리액션 행을 전부 떠서 JS로 세면 인기 메시지 하나가 페이지 하나의
 * 응답 크기를 좌우한다(1000명이 누르면 1000행). groupBy의 출력은 (메시지 × 서로 다른 이모지)
 * 로 묶여 있어 팔레트 크기가 곧 상한이고, '내가 뭘 눌렀나'는 userId 등호라 내 행만 온다.
 * 둘 다 messageId가 선두인 기본키 인덱스를 탄다.
 *
 * countReplies와 같은 이유로 Prisma의 `_count: { reactions }`는 쓰지 않는다 — 그건 필터 없는
 * 전 테이블 GROUP BY로 컴파일돼 비용이 전체 테넌트 합계에 비례한다(KAN-30에서 실측).
 */
async function loadReactions(
  messageIds: string[],
  viewerId: string,
): Promise<Map<string, ReactionView[]>> {
  if (messageIds.length === 0) {
    return new Map();
  }
  const [counts, mine] = await Promise.all([
    prisma.messageReaction.groupBy({
      by: ['messageId', 'emoji'],
      where: { messageId: { in: messageIds } },
      _count: { _all: true },
    }),
    prisma.messageReaction.findMany({
      where: { messageId: { in: messageIds }, userId: viewerId },
      select: { messageId: true, emoji: true },
    }),
  ]);

  const mineKeys = new Set(mine.map((row) => `${row.messageId}:${row.emoji}`));
  const byMessage = new Map<string, ReactionView[]>();
  // 표시 순서는 팔레트 순서로 고정한다 — groupBy의 행 순서는 보장이 없어서, 그대로 쓰면
  // 같은 메시지의 칩 순서가 새로고침마다 바뀐다.
  const order = new Map(REACTION_EMOJIS.map((emoji, index) => [emoji as string, index]));
  for (const row of counts) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push({
      emoji: row.emoji,
      count: row._count._all,
      mine: mineKeys.has(`${row.messageId}:${row.emoji}`),
    });
    byMessage.set(row.messageId, list);
  }
  for (const list of byMessage.values()) {
    list.sort((a, b) => (order.get(a.emoji) ?? 99) - (order.get(b.emoji) ?? 99));
  }
  return byMessage;
}

/**
 * 이 메시지들에 달린 답글 수를 한 번에 센다.
 *
 * Prisma의 `_count: { replies }`를 쓰지 않는다: 그건 상관 서브쿼리가 아니라
 * `LEFT JOIN (SELECT parentId, COUNT(*) FROM "ChatMessage" WHERE 1=1 GROUP BY parentId)`으로
 * 컴파일된다 — org·채널 필터가 전혀 없는 **전 테이블 GROUP BY**가 페이지 조회마다 한 번씩
 * 돈다. 즉 비용이 전체 테넌트 합계에 비례해서, 한 워크스페이스가 메시지를 쌓으면 다른
 * 워크스페이스의 채널 로딩까지 같이 느려진다(360k행 실측 113ms/13.8k buffers vs 0.33ms/423).
 * 여기서는 이번 페이지의 루트 id로 스코프한 groupBy 한 번만 돈다.
 *
 * 답글에는 아예 세지 않는다 — 스레드는 1단계라 답글의 답글 수는 언제나 0이다.
 */
async function countReplies(rootIds: string[]): Promise<Map<string, number>> {
  if (rootIds.length === 0) {
    return new Map();
  }
  const grouped = await prisma.chatMessage.groupBy({
    by: ['parentId'],
    where: { parentId: { in: rootIds } },
    _count: { _all: true },
  });
  return new Map(
    grouped.flatMap((row) => (row.parentId ? [[row.parentId, row._count._all] as const] : [])),
  );
}

// 여러 메시지의 작성자·답글 수·리액션을 한 번에 붙여 뷰로 만든다(N+1 방지).
// viewerId는 리액션의 mine을 채우는 데 쓴다 — 같은 메시지도 보는 사람마다 다르게 보인다.
async function toViews(messages: MessageRow[], viewerId: string): Promise<ChatMessageView[]> {
  const authorIds = [...new Set(messages.map((message) => message.authorId))];
  const rootIds = messages.filter((message) => !message.parentId).map((message) => message.id);
  const [authors, replyCounts, reactions] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: authorIds } } }),
    countReplies(rootIds),
    // 답글에도 리액션을 달 수 있으므로 루트만이 아니라 이 페이지 전부를 대상으로 한다.
    loadReactions(
      messages.map((message) => message.id),
      viewerId,
    ),
  ]);
  const authorById = new Map(authors.map((author) => [author.id, author]));
  return messages.map((message) =>
    toView(
      message,
      authorById.get(message.authorId) ?? null,
      replyCounts.get(message.id) ?? 0,
      reactions.get(message.id) ?? [],
    ),
  );
}

export const MESSAGE_PAGE_SIZE = 50;

/**
 * 한 페이지. messages는 언제나 오래된 것부터고, hasMore는 이 페이지보다 더 위(과거)에
 * 메시지가 남아 있는지다 — 클라이언트가 '더 불러오기'를 띄울지 정하는 유일한 근거다.
 * 다음 커서는 messages[0].id라 따로 내려보내지 않는다(클라이언트가 이미 들고 있다).
 */
export interface MessagePage {
  messages: ChatMessageView[];
  hasMore: boolean;
}

/**
 * 채널 메시지 한 페이지를 오래된 것부터 반환한다(KAN-29).
 *
 * before가 없으면 최신 페이지, 있으면 그 메시지보다 과거의 페이지다. OFFSET이 아니라
 * (createdAt, id) 키셋 커서를 쓴다 — OFFSET은 뒤로 갈수록 앞 행을 전부 훑고, 읽는 도중
 * 새 메시지가 들어오면 페이지 경계가 밀려 같은 메시지를 두 번 보게 된다.
 * 키셋은 @@index([channelId, createdAt])의 시작 경계로 들어가므로 깊은 페이지도 앞 구간을
 * 훑지 않는다(아래 createdAt lte 주석 참조 — 그 조건이 없으면 이 성질이 성립하지 않는다).
 *
 * 한계 하나: createdAt은 벽시계이고 트랜잭션 시작 시각이 박히므로, 커밋 순서가 역전되면
 * (A가 먼저 시각을 받고 B보다 늦게 커밋) 첫 페이지 조회 시점에 안 보였던 A가 이후 어느
 * 페이지에도 안 나올 수 있다. 실시간 브로드캐스트가 그 메시지를 하단에 붙여 실질적으로
 * 메우고 새로고침하면 정상화된다 — 단조 시퀀스가 필요해지면 그때 컬럼을 추가한다.
 *
 * 채널 접근 권한을 where에 실어 조회 자체가 매칭되지 않게 한다 — 남의 워크스페이스나
 * 참여하지 않은 비공개 채널의 id를 알아도 빈 배열만 나온다(쿼리 수준 격리).
 */
export function listMessages(
  orgId: string,
  userId: string,
  channelId: string,
  before?: string,
): Promise<MessagePage> {
  // parentId: null — 답글은 채널 본문에 섞이지 않는다. 스레드 패널에서만 보인다(KAN-30).
  return pageOf(
    { orgId, parentId: null, channel: { id: channelId, ...visibleWhere(orgId, userId) } },
    before,
    userId,
  );
}

/**
 * 키셋 페이지 조회의 공용 몸통. scope는 그 자체로 접근 판정이 끝난 where여야 한다 —
 * 커서 앵커도 같은 scope로 찾으므로, scope가 새면 커서로도 샌다.
 */
async function pageOf(
  scope: Prisma.ChatMessageWhereInput,
  before: string | undefined,
  viewerId: string,
): Promise<MessagePage> {
  // 커서는 메시지 id 하나만 받고 기준 시각은 서버가 되찾는다 — 클라이언트가 보낸
  // 타임스탬프를 믿으면 그걸 조작해 페이지 경계를 임의로 옮길 수 있다. 조회 자체를 같은
  // 스코프로 걸어, 남의 채널 메시지 id를 커서로 밀어 넣어도 앵커를 얻지 못한다.
  const anchor = before
    ? await prisma.chatMessage.findFirst({
        where: { id: before, ...scope },
        select: { id: true, createdAt: true },
      })
    : null;
  // 커서를 줬는데 못 찾았다면(위조된 id, 접근 권한 없는 채널의 id) 더 줄 것이 없다고 답한다.
  // '커서 유실'과 '이력 소진'을 한 값으로 뭉개는 것이라 완전하진 않다 — 메시지 삭제 기능이
  // 생겨 화면에 남은 커서가 실제로 사라질 수 있게 되면, 남은 이력이 있는데도 '더 보기'가
  // 사라지는 경로가 열린다. 그때 사유를 나눠 돌려주도록 계약을 넓혀야 한다.
  // 지금은 fail-closed가 맞다: 못 찾은 커서로 범위를 넓히면 그게 곧 접근 우회다.
  if (before && !anchor) {
    return { messages: [], hasMore: false };
  }

  const rows = await prisma.chatMessage.findMany({
    where: {
      ...scope,
      ...(anchor
        ? {
            // 인덱스 시작 경계. 아래 키셋만으로는 Postgres가 (channelId, createdAt) 인덱스의
            // 출발점을 못 잡아 커서보다 최신인 행을 전부 훑고 버린다(EXPLAIN 실측: Index
            // Cond가 channelId뿐, Rows Removed by Filter가 페이지 깊이만큼). 논리적으로는
            // 아래 조건에 포함되는 중복이지만, 이게 있어야 Index Cond에 createdAt이 올라간다.
            createdAt: { lte: anchor.createdAt },
            // 키셋 조건 — 커서보다 엄격히 과거인 행만. createdAt 동률(같은 ms 연속 전송)은
            // id로 갈라 커서가 자기 자신이나 동률 이웃을 다시 집지 않게 한다.
            // AND로 감싸는 이유: 이 OR을 최상위에 두면 나중에 누가 채널 가시성 조건을
            // 메시지 레벨로 평탄화했을 때 두 OR이 충돌해 조용히 서로를 덮어쓴다.
            AND: [
              {
                OR: [
                  { createdAt: { lt: anchor.createdAt } },
                  { createdAt: anchor.createdAt, id: { lt: anchor.id } },
                ],
              },
            ],
          }
        : {}),
    },
    // 정렬 키는 키셋 조건과 정확히 같은 (createdAt, id)여야 한다.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // 한 건 더 떠서 '더 있는지'를 별도 count 없이 판정한다.
    take: MESSAGE_PAGE_SIZE + 1,
  });

  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const messages = (hasMore ? rows.slice(0, MESSAGE_PAGE_SIZE) : rows).reverse();

  return { messages: await toViews(messages, viewerId), hasMore };
}

/** 스레드 = 루트 메시지 + 그 답글 한 페이지. */
export interface ThreadView {
  root: ChatMessageView;
  page: MessagePage;
}

/**
 * 스레드 한 건. 접근 판정은 루트 메시지에서 한 번 끝난다 — 루트가 보이면 그 답글도
 * 보이는 것이 스레드의 정의이므로, 답글 조회는 parentId만으로 스코프해도 샐 곳이 없다.
 * 답글이 많으면 채널 본문과 같은 키셋 커서로 위쪽을 더 불러온다.
 */
export async function listThread(
  orgId: string,
  userId: string,
  rootId: string,
  before?: string,
): Promise<ThreadView | null> {
  const root = await prisma.chatMessage.findFirst({
    // parentId: null — 답글의 id로는 스레드를 열 수 없다(스레드는 1단계뿐이다).
    where: { id: rootId, parentId: null, orgId, channel: visibleWhere(orgId, userId) },
  });
  if (!root) {
    return null;
  }

  const [rootView] = await toViews([root], userId);
  // 답글도 테넌트 스코프를 스스로 갖는다. 루트에서 접근 판정이 끝났다는 논리만으로도
  // 막히지만, '테넌트 데이터 조회에는 예외 없이 orgId를 싣는다'(backend.md)를 여기서만
  // 비우면 나중에 이 함수를 다른 데서 부를 때 방어선이 없다. 답글의 channelId가 부모와
  // 같다는 불변식도 DB로는 표현돼 있지 않으므로 한 겹 더 건다.
  const page = await pageOf({ parentId: rootId, orgId, channelId: root.channelId }, before, userId);
  return { root: rootView, page };
}

/**
 * 전송 결과. joined는 이번 전송이 슬랙식 자동 참여를 일으켰는지 — 액션이 이때만 채널
 * 목록을 재검증한다. 없으면 사이드바가 그 채널을 계속 '둘러보기'에 둔 채 굳는다
 * (목록은 레이아웃이 그리는데 레이아웃은 페이지 이동만으로 다시 안 불린다).
 */
export interface SendResult {
  message: ChatMessageView;
  joined: boolean;
}

/**
 * 접근할 수 없는 채널이면 null — 액션이 '채널을 찾을 수 없습니다'로 바꾼다.
 * parentId가 있으면 그 메시지의 답글이 된다. 부모는 **같은 채널의 루트 메시지**여야 한다:
 * 다른 채널의 메시지에 답글을 달면 그 답글은 어느 채널에도 안 보이는 고아가 되고,
 * 답글에 답글을 허용하면 화면에 없는 2단계 스레드가 데이터에만 생긴다(슬랙과 같은 1단계).
 */
export async function createMessage(
  orgId: string,
  authorId: string,
  channelId: string,
  body: string,
  parentId?: string,
): Promise<SendResult | null> {
  // 대상 채널이 이 워크스페이스의 것이고 내가 접근할 수 있는지 — 전송의 테넌트 경계다.
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, ...visibleWhere(orgId, authorId) },
    select: { id: true },
  });
  if (!channel) {
    return null;
  }

  if (parentId) {
    // channelId까지 where에 실어, 접근할 수 있는 다른 채널의 메시지도 부모가 될 수 없게 한다.
    const parent = await prisma.chatMessage.findFirst({
      where: { id: parentId, channelId, orgId, parentId: null },
      select: { id: true },
    });
    if (!parent) {
      return null;
    }
  }

  // 삭제된 워크스페이스·사용자로의 쓰기를 막는다 — 세션은 조직/계정이 지워진 뒤에도 토큰
  // 만료까지 살아 있어서, 그 사이 전송이 org 스켈레톤을 부활시키고 메시지를 영구 축적할 수
  // 있다(KAN-19). notes.createNote·board와 같은 pre/post 이중 확인 — 확인과 쓰기 사이에
  // 삭제가 커밋되면 cascade는 이미 끝난 뒤라 pre-check만으로는 부족하다.
  await assertNotTombstoned([orgId, authorId]);

  // org 스켈레톤은 여기서 만들지 않는다 — 위에서 채널 행을 찾았다는 것이 곧 org 미러가
  // 있다는 증명이다(Channel.orgId FK). 워크스페이스 부트스트랩은 ensureDefaultChannel이
  // 맡는다. 여기서 org를 create-if-absent 하면 '방금 삭제된 조직'을 되살리기만 한다.
  //
  // 두 번째 문장은 슬랙식 자동 참여다 — 둘러보던 공개 채널에 말을 걸면 '내 채널'로 들어온다.
  // 조건 분기 없이 항상 실행한다: 이미 참여 중이면(비공개 채널은 참여자만 여기 도달한다)
  // ON CONFLICT DO NOTHING으로 아무 일도 일어나지 않는다.
  // userSkeleton이 필요한 것도 이 문장 때문이다 — ChannelMember.userId에는 FK가 있어,
  // user.created 웹훅이 늦은 새 멤버의 첫 발언이 FK 위반으로 죽지 않게 한다.
  const [, join, message] = await prisma.$transaction([
    userSkeleton(authorId),
    prisma.channelMember.createMany({ data: [{ channelId, userId: authorId }], skipDuplicates: true }),
    prisma.chatMessage.create({ data: { orgId, channelId, authorId, body, parentId } }),
  ]);
  const joined = join.count > 0;

  // post-check — 방금 되살렸을 수 있는 org·user를 자가 정리한다. org tombstone이면 cascade로
  // 메시지까지 지워지지만, user tombstone 경로에서는 메시지가 남으므로 명시적으로 지운다.
  // 참여 행은 이번에 만든 것만 되돌린다(원래 멤버였다면 건드릴 이유가 없다).
  await assertNotTombstoned([orgId, authorId], async () => {
    await prisma.chatMessage.deleteMany({ where: { id: message.id } });
    if (joined) {
      await prisma.channelMember.deleteMany({ where: { channelId, userId: authorId } });
    }
  });

  const author = await prisma.user.findUnique({ where: { id: authorId } });
  // 새로 만든 메시지의 답글 수는 언제나 0이다(방금 생겼고, 답글은 1단계라 답글의 답글도 없다).
  // 리액션도 마찬가지로 아직 없다.
  return { message: toView(message, author, 0, []), joined };
}

/**
 * 리액션 토글 (KAN-31). 이미 눌러 둔 이모지면 취소하고, 아니면 추가한다.
 * 접근할 수 없는 메시지면 null — 액션이 '대상을 찾을 수 없습니다'로 바꾼다.
 *
 * 반환값의 count는 토글 직후 다시 센 절대값이다. 응답과 브로드캐스트가 같은 값을 싣기
 * 때문에 어느 경로로 먼저 도착하든, 몇 번 도착하든 수신 측 상태가 같은 곳에 수렴한다.
 */
export async function toggleReaction(
  orgId: string,
  userId: string,
  messageId: string,
  emoji: string,
): Promise<ReactionDelta | null> {
  // 리액션의 접근 판정은 '그 메시지가 나에게 보이는가' 하나다 — 메시지를 볼 수 있으면
  // 리액션도 할 수 있다(슬랙과 같다). 채널 가시성 판정은 여기서도 visibleWhere를 통과한다.
  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, orgId, channel: visibleWhere(orgId, userId) },
    select: { id: true, channelId: true, parentId: true },
  });
  if (!message) {
    return null;
  }

  // 삭제된 워크스페이스·사용자로의 쓰기를 막는다(createMessage와 같은 pre/post 이중 확인).
  await assertNotTombstoned([orgId, userId]);

  // 먼저 지워 보고, 지워진 게 없으면 추가다. '조회 후 분기'로 하면 두 탭에서 동시에 누를 때
  // 둘 다 '없음'을 보고 둘 다 추가로 가는데, 그때 두 번째는 유니크 위반으로 죽는다.
  // deleteMany의 반환 count가 그 자체로 원자적인 판정이라 경합이 생기지 않는다.
  const removed = await prisma.messageReaction.deleteMany({
    where: { messageId, userId, emoji },
  });
  const added = removed.count === 0;
  if (added) {
    // skipDuplicates — 위 delete와 이 create 사이에 다른 탭이 같은 리액션을 넣었을 수 있다.
    // 그 경우 '이미 눌린 상태'가 우리가 만들려던 상태와 같으므로 실패로 볼 이유가 없다.
    await prisma.messageReaction.createMany({
      data: [{ messageId, userId, emoji, orgId }],
      skipDuplicates: true,
    });
  }

  // post-check — 확인과 쓰기 사이에 조직·계정 삭제가 커밋됐으면 방금 만든 행을 되돌린다.
  // org 삭제는 cascade가 이미 지웠을 수 있어 deleteMany는 멱등하게 동작한다.
  if (added) {
    await assertNotTombstoned([orgId, userId], async () => {
      await prisma.messageReaction.deleteMany({ where: { messageId, userId, emoji } });
    });
  }

  // 토글 직후 다시 센다 — 내 변경분만 더하면 그 사이 다른 사람이 누른 것이 빠진다.
  const count = await prisma.messageReaction.count({ where: { messageId, emoji } });
  return {
    messageId,
    channelId: message.channelId,
    parentId: message.parentId,
    emoji,
    count,
    userId,
    added,
  };
}
