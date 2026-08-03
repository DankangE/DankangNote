import { describe, expect, it } from 'vitest';
import {
  dropTyping,
  noteTyping,
  presentMember,
  pruneTyping,
  typingLabel,
  withMember,
  withoutMember,
  TYPING_PING_MS,
  TYPING_TTL_MS,
  type PresentMember,
  type TypingEntry,
} from './presence';

// 순수 로직이라 DB도 소켓도 필요 없다 — 시간은 now를 넣어 확인한다.

const NOW = 1_700_000_000_000;

const member = (id: string, name: string): PresentMember => ({ id, name, imageUrl: null });

describe('프레즌스 멤버 (KAN-34)', () => {
  it('채널 인증이 실어 보낸 표시 정보를 읽는다', () => {
    expect(presentMember('user_1', { name: '단 강', imageUrl: 'https://img/1.png' })).toEqual({
      id: 'user_1',
      name: '단 강',
      imageUrl: 'https://img/1.png',
    });
  });

  it('이름이 비어 있으면 id로 떨어진다 — 목록에서 사람이 사라지는 것보다 낫다', () => {
    expect(presentMember('user_1', { name: '   ' })).toEqual({
      id: 'user_1',
      name: 'user_1',
      imageUrl: null,
    });
    expect(presentMember('user_1', null)).toEqual({
      id: 'user_1',
      name: 'user_1',
      imageUrl: null,
    });
  });

  it('id가 없으면 멤버가 아니다', () => {
    expect(presentMember(undefined, { name: '단 강' })).toBeNull();
    expect(presentMember('', { name: '단 강' })).toBeNull();
  });

  it('같은 사람이 탭을 여럿 열어도 한 명으로 센다', () => {
    const first = withMember([], member('user_1', '단 강'));
    const second = withMember(first, member('user_1', '단 강'));

    expect(second).toHaveLength(1);
  });

  it('이름순으로 고정한다 — 도착 순서가 순서가 되면 재접속마다 아바타가 뒤바뀐다', () => {
    const list = withMember(withMember([], member('user_2', '홍 길동')), member('user_1', '가 나다'));

    expect(list.map((entry) => entry.id)).toEqual(['user_1', 'user_2']);
  });

  it('없는 사람을 빼면 배열을 그대로 돌려준다', () => {
    const list = withMember([], member('user_1', '단 강'));

    expect(withoutMember(list, 'user_9')).toBe(list);
    expect(withoutMember(list, 'user_1')).toEqual([]);
  });
});

describe('타이핑 만료 (KAN-34)', () => {
  it('같은 사람이 계속 쳐도 한 줄이다 — 쌓이면 혼자서 여러 명이 된다', () => {
    const once = noteTyping([], 'user_1', NOW);
    const twice = noteTyping(once, 'user_1', NOW + TYPING_PING_MS);

    expect(twice).toEqual([{ userId: 'user_1', expiresAt: NOW + TYPING_PING_MS + TYPING_TTL_MS }]);
  });

  it('핑 간격만큼 지나도 만료되지 않는다 — TTL이 짧으면 계속 치는 동안 표시가 깜빡인다', () => {
    const entries = noteTyping([], 'user_1', NOW);

    expect(pruneTyping(entries, NOW + TYPING_PING_MS)).toHaveLength(1);
    expect(pruneTyping(entries, NOW + TYPING_TTL_MS + 1)).toHaveLength(0);
  });

  it('걷어낼 게 없으면 받은 배열을 그대로 돌려준다 (1초 타이머가 렌더를 부르지 않게)', () => {
    const entries = noteTyping([], 'user_1', NOW);

    expect(pruneTyping(entries, NOW + 1)).toBe(entries);
  });

  it('메시지가 도착한 사람은 만료를 기다리지 않고 내린다', () => {
    const entries = noteTyping(noteTyping([], 'user_1', NOW), 'user_2', NOW);

    expect(dropTyping(entries, 'user_1')).toEqual([
      { userId: 'user_2', expiresAt: NOW + TYPING_TTL_MS },
    ]);
    // 대상이 없으면 여기서도 참조를 지킨다.
    expect(dropTyping(entries, 'user_9')).toBe(entries);
  });

  it('새 핑을 반영할 때 이미 만료된 남의 항목도 함께 걷어낸다', () => {
    const stale = noteTyping([], 'user_1', NOW);
    const fresh = noteTyping(stale, 'user_2', NOW + TYPING_TTL_MS + 1);

    expect(fresh.map((entry) => entry.userId)).toEqual(['user_2']);
  });
});

describe('입력 중 문구 (KAN-34)', () => {
  const members = [member('user_1', '단 강'), member('user_2', '홍 길동')];
  const entry = (userId: string): TypingEntry => ({ userId, expiresAt: NOW + TYPING_TTL_MS });

  it('아무도 없으면 빈 문자열 — 자리만 남고 아무것도 읽히지 않는다', () => {
    expect(typingLabel([], members)).toBe('');
  });

  it('한 명은 이름으로 부른다', () => {
    expect(typingLabel([entry('user_1')], members)).toBe('단 강님이 입력 중…');
  });

  it('프레즌스 목록에 없는 사람은 조사 없이 누군가로 부른다', () => {
    expect(typingLabel([entry('user_9')], members)).toBe('누군가 입력 중…');
    // 아는 이름이 하나도 없을 때만 그렇다.
    expect(typingLabel([entry('user_8'), entry('user_9')], members)).toBe(
      '누군가 외 1명이 입력 중…',
    );
  });

  it('여럿은 외 N명으로 접는다 — 이름을 나열하면 조사가 받침 따라 어긋난다', () => {
    expect(typingLabel([entry('user_1'), entry('user_2')], members)).toBe(
      '단 강님 외 1명이 입력 중…',
    );
  });

  it('대표는 도착 순서가 아니라 이름순 — 둘이 함께 치는 동안 앞자리가 바뀌면 안 된다', () => {
    // noteTyping은 새 핑을 뒤에 붙인다. 도착 순서로 고르면 핑이 오갈 때마다(2.5초) 문구의
    // 이름이 상대편으로 넘어간다 — 같은 두 사람인데 화면만 계속 흔들린다.
    const arrived = noteTyping(noteTyping([], 'user_1', NOW), 'user_2', NOW);
    const reversed = noteTyping(arrived, 'user_1', NOW + TYPING_PING_MS);

    expect(reversed.map((item) => item.userId)).toEqual(['user_2', 'user_1']);
    expect(typingLabel(reversed, members)).toBe(typingLabel(arrived, members));
  });

  it('이름을 아는 사람이 있으면 모르는 사람보다 앞세운다', () => {
    expect(typingLabel([entry('user_9'), entry('user_1')], members)).toBe(
      '단 강님 외 1명이 입력 중…',
    );
  });
});
