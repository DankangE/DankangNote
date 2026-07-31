import { describe, expect, it } from 'vitest';
import { spansForPicked, splitBody, type PickedMention } from './mentions';

// 순수 로직이라 DB가 필요 없다 — 서비스 테스트와 달리 여기서는 오프셋 계산만 본다.

describe('스팬 찾기 (KAN-32)', () => {
  it('한 이름이 다른 이름의 접두사여도 긴 쪽이 자리를 먼저 잡는다', async () => {
    // '단'이 '@단 강' 안쪽에 매칭돼 자리를 차지하면, 본문에 이름이 적힌 '단 강'은 알림을
    // 못 받고 본문에 나오지도 않는 '단'이 받는다. picked는 삽입 텍스트를 지워도 남는다.
    const picked: PickedMention[] = [
      { kind: 'user', userId: 'u_dan', label: '단' },
      { kind: 'user', userId: 'u_dankang', label: '단 강' },
    ];

    expect(spansForPicked('@단 강 님 확인 부탁드려요', picked)).toEqual([
      { kind: 'user', userId: 'u_dankang', start: 0, length: 4 },
    ]);
  });

  it('같은 사람을 두 번 골랐으면 서로 다른 자리를 하나씩 집는다', () => {
    const picked: PickedMention[] = [
      { kind: 'user', userId: 'u1', label: '단 강' },
      { kind: 'user', userId: 'u1', label: '단 강' },
    ];

    expect(spansForPicked('@단 강 그리고 @단 강', picked).map((s) => s.start)).toEqual([0, 9]);
  });

  it('지워진 멘션은 조용히 빠진다', () => {
    const picked: PickedMention[] = [{ kind: 'user', userId: 'u1', label: '단 강' }];
    expect(spansForPicked('그냥 하는 말', picked)).toEqual([]);
  });
});

describe('본문 자르기 (KAN-32)', () => {
  it('이모지가 섞여도 조각을 이어 붙이면 원문 그대로다', () => {
    // 오프셋은 UTF-16 코드 유닛 기준이라 서로게이트 페어가 경계를 깨뜨리면 안 된다.
    const body = '안녕 @단강🎉 님 🚀 반가워요';
    const spans = spansForPicked(body, [{ kind: 'user', userId: 'u1', label: '단강🎉' }]);

    // '@단강🎉' = 5 코드 유닛(@ + 단 + 강 + 서로게이트 페어 2).
    expect(spans).toEqual([{ kind: 'user', userId: 'u1', start: 3, length: 5 }]);
    const parts = splitBody(body, spans);
    expect(parts.map((p) => p.text).join('')).toBe(body);
    expect(parts.find((p) => p.type === 'mention')?.text).toBe('@단강🎉');
  });

  it('겹치는 스팬은 하나만 남고 본문은 손실되지 않는다', () => {
    const body = '@단 강 님';
    const parts = splitBody(body, [
      { kind: 'user', userId: 'a', start: 0, length: 4 },
      { kind: 'user', userId: 'b', start: 1, length: 2 },
    ]);

    expect(parts.filter((p) => p.type === 'mention')).toHaveLength(1);
    expect(parts.map((p) => p.text).join('')).toBe(body);
  });

  it('본문 밖을 가리키는 스팬은 건너뛰고 뒤 텍스트를 지킨다', () => {
    const body = '짧은 본문';
    const parts = splitBody(body, [{ kind: 'user', userId: 'a', start: 50, length: 5 }]);
    expect(parts.map((p) => p.text).join('')).toBe(body);
  });
});
