import { describe, expect, it } from 'vitest';
import { applyReaction, hasMyReaction, setMyReaction, type RoomMessage } from './room-state';
import type { ReactionDelta, ReactionView } from './types';

// 순수 함수라 DB도 렌더도 필요 없다 — 규칙이 시간·순서에 얽혀 있어 입력으로 확인한다.

const VIEWER = 'user_me';
const OTHER = 'user_other';

function message(reactions: ReactionView[], reactionVersion = 0): RoomMessage {
  return {
    id: 'msg_1',
    channelId: 'chan_a',
    parentId: null,
    authorId: OTHER,
    authorName: '홍 길동',
    authorImageUrl: null,
    body: '안녕하세요',
    createdAt: '2026-01-01T00:00:00.000Z',
    replyCount: 0,
    reactions,
    reactionVersion,
    mentions: [],
  };
}

function delta(overrides: Partial<ReactionDelta> = {}): ReactionDelta {
  return {
    messageId: 'msg_1',
    channelId: 'chan_a',
    parentId: null,
    emoji: '👍',
    count: 1,
    version: 1,
    userId: OTHER,
    added: true,
    ...overrides,
  };
}

const countOf = (list: RoomMessage[], emoji = '👍') =>
  list[0].reactions.find((reaction) => reaction.emoji === emoji)?.count;

describe('리액션 델타 적용 (KAN-31)', () => {
  it('절대 count를 그대로 덮는다 — 같은 델타가 두 번 와도 결과가 같다', () => {
    const once = applyReaction([message([])], delta({ count: 3, version: 5 }), VIEWER);
    // 중복 배달은 같은 번호로 다시 온다 — 버려지지만 값도 어차피 같다.
    const twice = applyReaction(once, delta({ count: 3, version: 5 }), VIEWER);

    expect(countOf(once)).toBe(3);
    expect(countOf(twice)).toBe(3);
  });

  it('마지막 한 명이 취소하면 칩 자체를 없앤다', () => {
    const list = applyReaction(
      [message([{ emoji: '👍', count: 1, mine: false }])],
      delta({ count: 0, added: false, version: 2 }),
      VIEWER,
    );

    expect(list[0].reactions).toEqual([]);
  });

  it('mine은 내가 누른 델타에서만 바뀐다', () => {
    const mineOn = applyReaction([message([])], delta({ userId: VIEWER, version: 1 }), VIEWER);
    // 남이 누른 델타는 count만 옮기고 내 표시를 건드리지 않는다.
    const otherAdds = applyReaction(mineOn, delta({ count: 2, userId: OTHER, version: 2 }), VIEWER);

    expect(hasMyReaction(mineOn[0], '👍')).toBe(true);
    expect(hasMyReaction(otherAdds[0], '👍')).toBe(true);
    expect(countOf(otherAdds)).toBe(2);
  });

  it('목록에 없는 메시지의 델타는 아무 일도 하지 않는다', () => {
    const list = [message([])];

    expect(applyReaction(list, delta({ messageId: 'msg_other' }), VIEWER)).toEqual(list);
  });
});

describe('역순 배달 방어 (KAN-52)', () => {
  it('이미 적용한 것보다 낮은 버전은 버린다', () => {
    // 티켓의 재현 그대로 — A가 count=1을 읽고 지연되는 사이 B가 count=2를 먼저 쏜다.
    const afterB = applyReaction([message([])], delta({ count: 2, version: 2 }), VIEWER);
    const afterLateA = applyReaction(afterB, delta({ count: 1, version: 1 }), VIEWER);

    // 절대값만 보던 시절에는 여기서 1로 굳었다.
    expect(countOf(afterLateA)).toBe(2);
  });

  it('조회 스냅샷보다 낮은 델타도 버린다 — 페이지를 여는 사이 날아오던 것', () => {
    // 서버가 준 목록은 이미 버전 10까지 반영한 값이다. 그 이전 델타가 뒤늦게 도착해도
    // 화면을 되돌리면 안 된다.
    const loaded = [message([{ emoji: '👍', count: 4, mine: false }], 10)];

    expect(countOf(applyReaction(loaded, delta({ count: 1, version: 9 }), VIEWER))).toBe(4);
    expect(countOf(applyReaction(loaded, delta({ count: 5, version: 11 }), VIEWER))).toBe(5);
  });

  it('칩이 사라진 뒤에 온 옛 델타가 그 칩을 되살리지 못한다', () => {
    // 번호를 칩이 아니라 메시지에 남기는 이유다 — 칩과 함께 잊으면 여기서 되살아난다.
    const emptied = applyReaction(
      [message([{ emoji: '👍', count: 1, mine: false }])],
      delta({ count: 0, added: false, version: 7 }),
      VIEWER,
    );
    const lateAdd = applyReaction(emptied, delta({ count: 1, version: 6 }), VIEWER);

    expect(lateAdd[0].reactions).toEqual([]);
  });

  it('이모지마다 따로 센다 — 옆 칩의 높은 번호에 내 델타가 걸리지 않는다', () => {
    // 메시지 하나로 뭉뚱그리면(마지막 번호 하나만 기억하면) 여기서 🎉가 조용히 사라진다.
    const withHeart = applyReaction([message([])], delta({ emoji: '❤️', version: 9 }), VIEWER);
    const withParty = applyReaction(withHeart, delta({ emoji: '🎉', version: 8 }), VIEWER);

    expect(countOf(withParty, '❤️')).toBe(1);
    expect(countOf(withParty, '🎉')).toBe(1);
  });

  it('낙관 적용은 버전을 건드리지 않는다 — 뒤따라온 서버 델타가 그대로 통과한다', () => {
    // 내 클릭은 서버를 기다리지 않고 먼저 반영된다. 그때 번호를 올려 버리면 정작
    // 확정본이 '이미 본 것'으로 버려진다.
    const optimistic = setMyReaction([message([], 3)], 'msg_1', '👍', VIEWER, true);
    const confirmed = applyReaction(
      optimistic,
      delta({ count: 2, userId: VIEWER, version: 4 }),
      VIEWER,
    );

    expect(countOf(optimistic)).toBe(1);
    expect(countOf(confirmed)).toBe(2);
  });
});
