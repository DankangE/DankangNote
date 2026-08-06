import { describe, expect, it } from 'vitest';
import type { NoteTreeNode } from '@/features/notes/types';
import { applyMove, flattenTree, projectDrop, subtreeIds } from './tree';

// 순수 로직 테스트 — DB 없이 트리 조립·투영·낙관적 이동의 규칙을 고정한다.

function node(id: string, parentId: string | null = null, position = 0): NoteTreeNode {
  return { id, title: id, parentId, position, authorId: null };
}

// root ─ a ─ a1
//          └ a2
//      └ b
const NODES: NoteTreeNode[] = [
  node('a', null, 0),
  node('b', null, 1),
  node('a1', 'a', 0),
  node('a2', 'a', 1),
];

describe('flattenTree', () => {
  it('DFS 순서로 펴고 depth를 붙인다', () => {
    const rows = flattenTree(NODES, new Set());
    expect(rows.map((row) => [row.node.id, row.depth])).toEqual([
      ['a', 0],
      ['a1', 1],
      ['a2', 1],
      ['b', 0],
    ]);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[3].hasChildren).toBe(false);
  });

  it('접힌 노드의 자손은 빠진다', () => {
    const rows = flattenTree(NODES, new Set(['a']));
    expect(rows.map((row) => row.node.id)).toEqual(['a', 'b']);
  });

  it('부모가 목록에 없는 고아는 루트로 취급한다', () => {
    const rows = flattenTree([node('x', 'ghost')], new Set());
    expect(rows.map((row) => [row.node.id, row.depth])).toEqual([['x', 0]]);
  });
});

describe('subtreeIds', () => {
  it('자기 자신과 모든 자손을 담는다', () => {
    expect(subtreeIds(NODES, 'a')).toEqual(new Set(['a', 'a1', 'a2']));
    expect(subtreeIds(NODES, 'b')).toEqual(new Set(['b']));
  });
});

describe('projectDrop', () => {
  const rows = flattenTree(NODES, new Set());

  it('가로 이동 없이 형제 위로 끌면 같은 깊이의 재정렬이다', () => {
    // b를 a 자리(맨 위)로 — 루트 그룹의 0번째.
    expect(projectDrop(rows, 'b', 'a', 0)).toEqual({ parentId: null, index: 0, depth: 0 });
  });

  it('한 칸 들여 끌면 위 행의 자식이 된다', () => {
    // b를 a2 자리에 +1 들여쓰기로 끼워 넣기 — a의 자식 그룹에서 a2 자리(1번째)를 차지.
    expect(projectDrop(rows, 'b', 'a2', 1)).toEqual({ parentId: 'a', index: 1, depth: 1 });
  });

  it('깊이는 위·아래 행이 허용하는 범위로 클램프된다', () => {
    // a1 자리(위가 루트 a, 아래가 a2)에서 5칸 들여쓰기해도 최대 a의 자식 깊이까지만.
    expect(projectDrop(rows, 'b', 'a1', 5)).toEqual({ parentId: 'a', index: 0, depth: 1 });
  });

  it('내어 끌면 상위 그룹으로 나온다', () => {
    // a2를 제자리에서 -1 내어쓰기 — 루트 그룹, a 다음 위치.
    expect(projectDrop(rows, 'a2', 'a2', -1)).toEqual({ parentId: null, index: 1, depth: 0 });
  });

  it('중간 삽입의 index는 위쪽 형제 수다', () => {
    // a1을 b 자리로(맨 아래, 루트 깊이) — 루트 그룹에서 b 다음이니 index 2.
    expect(projectDrop(rows, 'a1', 'b', -1)).toEqual({ parentId: null, index: 2, depth: 0 });
  });
});

describe('applyMove', () => {
  it('대상 그룹의 지정 위치로 옮기고 position을 0..n으로 재부여한다', () => {
    const next = applyMove(NODES, { id: 'b', parentId: 'a', index: 1 });
    const rows = flattenTree(next, new Set());
    expect(rows.map((row) => row.node.id)).toEqual(['a', 'a1', 'b', 'a2']);
    const a2 = next.find((candidate) => candidate.id === 'a2');
    expect(a2?.position).toBe(2);
  });

  it('자기 자손 밑으로의 이동은 무시한다 (사이클 방지)', () => {
    expect(applyMove(NODES, { id: 'a', parentId: 'a1', index: 0 })).toBe(NODES);
  });

  it('없는 노드 이동은 무시한다', () => {
    expect(applyMove(NODES, { id: 'ghost', parentId: null, index: 0 })).toBe(NODES);
  });
});
