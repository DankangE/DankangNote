import 'server-only';

import { prisma } from '@/server/db';
import type { Prisma, User } from '@/server/generated/prisma/client';
import { visibleWhere } from '@/server/services/channels';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { userSkeleton } from '@/server/services/skeleton';
import { displayName } from '@/server/services/user-display';
import type { ChatMessageView } from '@/features/chat/types';

// 답글 수는 매번 세지 않고 관계 카운트로 함께 받는다 — 루트 목록 한 페이지에 대해 상관
// 서브쿼리 한 번이라, 별도 groupBy 왕복이나 비정규화 카운터(드리프트)보다 낫다.
const WITH_REPLY_COUNT = { _count: { select: { replies: true } } } as const;

type MessageRow = Prisma.ChatMessageGetPayload<{ include: typeof WITH_REPLY_COUNT }>;

// 작성자 표시는 Clerk 미러 User에서 읽는다 — webhook 동기화 전이면 id로 대체.
// ChatMessage.authorId에 FK를 안 두는 이유이기도 하다(전송이 동기화 순서에 안 묶이게).
function toView(message: MessageRow, author: User | null): ChatMessageView {
  return {
    id: message.id,
    channelId: message.channelId,
    parentId: message.parentId,
    authorId: message.authorId,
    authorName: author ? displayName(author) : message.authorId,
    authorImageUrl: author?.imageUrl ?? null,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    replyCount: message._count.replies,
  };
}

// 여러 메시지의 작성자를 한 번에 조인해 뷰로 만든다(N+1 방지).
async function toViews(messages: MessageRow[]): Promise<ChatMessageView[]> {
  const authorIds = [...new Set(messages.map((message) => message.authorId))];
  const authors = await prisma.user.findMany({ where: { id: { in: authorIds } } });
  const authorById = new Map(authors.map((author) => [author.id, author]));
  return messages.map((message) => toView(message, authorById.get(message.authorId) ?? null));
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
  );
}

/**
 * 키셋 페이지 조회의 공용 몸통. scope는 그 자체로 접근 판정이 끝난 where여야 한다 —
 * 커서 앵커도 같은 scope로 찾으므로, scope가 새면 커서로도 샌다.
 */
async function pageOf(
  scope: Prisma.ChatMessageWhereInput,
  before: string | undefined,
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
    include: WITH_REPLY_COUNT,
  });

  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const messages = (hasMore ? rows.slice(0, MESSAGE_PAGE_SIZE) : rows).reverse();

  return { messages: await toViews(messages), hasMore };
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
    include: WITH_REPLY_COUNT,
  });
  if (!root) {
    return null;
  }

  const [rootView] = await toViews([root]);
  return { root: rootView, page: await pageOf({ parentId: rootId }, before) };
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
    prisma.chatMessage.create({
      data: { orgId, channelId, authorId, body, parentId },
      include: WITH_REPLY_COUNT,
    }),
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
  return { message: toView(message, author), joined };
}
