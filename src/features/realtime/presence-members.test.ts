import { describe, expect, it } from 'vitest';
import {
  presentMember,
  withMember,
  withoutMember,
  type PresentMember,
} from './presence-members';

// 순수 로직이라 DB도 소켓도 필요 없다.

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
