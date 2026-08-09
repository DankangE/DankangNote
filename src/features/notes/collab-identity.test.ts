import { describe, expect, it } from 'vitest';
import { CARET_COLORS, CaretDirectory, caretColor } from './collab-identity';
import type { PresentMember } from '@/features/realtime/presence-members';

// 소켓도 에디터도 필요 없다 — 이 파일이 고정하는 건 '무엇을 믿는가' 하나다.

const member = (id: string, name: string): PresentMember => ({ id, name, imageUrl: null });

describe('커서 색 (KAN-75)', () => {
  it('같은 사람은 늘 같은 색 — 새로고침마다 바뀌면 색으로 사람을 못 알아본다', () => {
    expect(caretColor('user_1')).toBe(caretColor('user_1'));
  });

  it('팔레트 안에서만 고른다', () => {
    for (const id of ['user_1', 'user_2', 'a', '', '단강']) {
      expect(CARET_COLORS).toContain(caretColor(id));
    }
  });

  it('사람이 몇 명 없어도 색이 겹치지 않을 만큼은 흩어진다', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `user_${index + 1}`);
    const used = new Set(ids.map(caretColor));

    expect(used.size).toBeGreaterThanOrEqual(4);
  });
});

describe('커서 신원 해석 (KAN-75)', () => {
  it('이름은 프레즌스에서 온다 — awareness 페이로드는 이 표에 들어올 자리가 없다', () => {
    const directory = new CaretDirectory();
    directory.replaceMembers([member('user_1', '단 강')]);
    directory.bind([11], 'user_1');

    expect(directory.resolve(11)).toEqual({
      userId: 'user_1',
      name: '단 강',
      color: caretColor('user_1'),
    });
  });

  it('주인을 모르는 clientId는 그리지 않는다', () => {
    const directory = new CaretDirectory();
    directory.replaceMembers([member('user_1', '단 강')]);

    expect(directory.resolve(11)).toBeNull();
  });

  it('프레즌스에 없는 사람의 커서도 그리지 않는다 — 신원 없는 커서를 정상처럼 그리면 안 된다', () => {
    const directory = new CaretDirectory();
    directory.bind([11], 'user_1');

    expect(directory.resolve(11)).toBeNull();
  });

  it('남의 clientId를 실어 와도 주인이 바뀌지 않는다 — 커서 이름표 가로채기', () => {
    const directory = new CaretDirectory();
    directory.replaceMembers([member('user_1', '단 강'), member('user_2', '홍 길동')]);
    directory.bind([11], 'user_1');

    // user_2가 user_1의 clientId를 자기 업데이트에 실어 보낸 상황.
    const rejected = directory.bind([11, 22], 'user_2');

    expect(rejected).toEqual([11]);
    expect(directory.resolve(11)?.userId).toBe('user_1');
    expect(directory.resolve(22)?.userId).toBe('user_2');
  });

  it('같은 사람이 같은 clientId를 다시 실어 보내는 건 정상이다', () => {
    const directory = new CaretDirectory();
    directory.replaceMembers([member('user_1', '단 강')]);
    directory.bind([11], 'user_1');

    expect(directory.bind([11], 'user_1')).toEqual([]);
  });

  it('탭 하나가 여러 clientId를 가질 수 있다(재연결) — 둘 다 같은 사람으로 푼다', () => {
    const directory = new CaretDirectory();
    directory.replaceMembers([member('user_1', '단 강')]);
    directory.bind([11, 12], 'user_1');

    expect(directory.resolve(11)?.name).toBe('단 강');
    expect(directory.resolve(12)?.name).toBe('단 강');
  });

  it('나간 사람의 clientId를 돌려준다 — 타임아웃(30초)을 기다리면 유령 커서가 남는다', () => {
    const directory = new CaretDirectory();
    directory.replaceMembers([member('user_1', '단 강'), member('user_2', '홍 길동')]);
    directory.bind([11, 12], 'user_1');
    directory.bind([22], 'user_2');

    expect(directory.removeMember('user_1').sort()).toEqual([11, 12]);
    expect(directory.resolve(11)).toBeNull();
    expect(directory.resolve(22)?.userId).toBe('user_2');
  });

  it('나갔다 들어온 사람의 clientId는 다시 잡을 수 있다', () => {
    const directory = new CaretDirectory();
    directory.replaceMembers([member('user_1', '단 강')]);
    directory.bind([11], 'user_1');
    directory.removeMember('user_1');

    directory.addMember(member('user_1', '단 강'));

    expect(directory.bind([11], 'user_1')).toEqual([]);
    expect(directory.resolve(11)?.userId).toBe('user_1');
  });

  it('명단을 갈아끼워도 이미 잡힌 연결은 유지된다 — 구독 재성립에 커서가 통째로 죽으면 안 된다', () => {
    const directory = new CaretDirectory();
    directory.replaceMembers([member('user_1', '단 강')]);
    directory.bind([11], 'user_1');

    directory.replaceMembers([member('user_1', '단 강'), member('user_2', '홍 길동')]);

    expect(directory.resolve(11)?.userId).toBe('user_1');
  });

  it('hasMember는 서명 없는 발신자를 거르는 자리다', () => {
    const directory = new CaretDirectory();
    directory.replaceMembers([member('user_1', '단 강')]);

    expect(directory.hasMember('user_1')).toBe(true);
    expect(directory.hasMember('user_9')).toBe(false);
  });

  it('사라진 clientId는 잊는다 — 재접속하면 새 번호로 다시 잡힌다', () => {
    const directory = new CaretDirectory();
    directory.replaceMembers([member('user_1', '단 강')]);
    directory.bind([11], 'user_1');

    directory.unbind([11]);

    expect(directory.resolve(11)).toBeNull();
    expect(directory.bind([11], 'user_2')).toEqual([]);
  });
});
