import type { NoteTreeNode } from '@/features/notes/types';

// 문서 트리의 순수 로직(KAN-37) — 조립·평탄화·드롭 투영·낙관적 이동을 전부 여기서
// 계산한다. 서버는 flat 목록만 내리고(services/note-tree.ts), 이 모듈은 DB 없이
// 단위 테스트된다(tree.test.ts).

export interface TreeRow {
  node: NoteTreeNode;
  depth: number;
  hasChildren: boolean;
}

// parentId → 자식 목록. 입력 배열 순서(서버 정렬: position, createdAt)를 그대로
// 보존한다. 부모가 목록에 없는 노드는 루트로 취급 — 렌더에서 조용히 빠져 '보이지
// 않는 문서'가 되는 것보다 낫다(정상 데이터에선 안 생기는 방어).
export function childrenByParent(nodes: NoteTreeNode[]): Map<string | null, NoteTreeNode[]> {
  const ids = new Set(nodes.map((node) => node.id));
  const map = new Map<string | null, NoteTreeNode[]>();
  for (const node of nodes) {
    const key = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;
    const group = map.get(key);
    if (group) group.push(node);
    else map.set(key, [node]);
  }
  return map;
}

// 접힘 상태를 반영해 보이는 행만 DFS로 편다. visited 가드는 만에 하나 데이터에
// 사이클이 있어도(서버가 막지만) 무한 루프 대신 그 가지만 잘리게 한다.
export function flattenTree(nodes: NoteTreeNode[], collapsed: ReadonlySet<string>): TreeRow[] {
  const byParent = childrenByParent(nodes);
  const rows: TreeRow[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      rows.push({ node, depth, hasChildren: (byParent.get(node.id) ?? []).length > 0 });
      if (!collapsed.has(node.id)) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

// id 자신 + 모든 자손. 드래그 중 함께 움직일(목록에서 숨길) 범위이자 사이클 가드.
export function subtreeIds(nodes: NoteTreeNode[], id: string): Set<string> {
  const byParent = childrenByParent(nodes);
  const result = new Set<string>([id]);
  const stack = [id];
  while (stack.length > 0) {
    for (const child of byParent.get(stack.pop()!) ?? []) {
      if (!result.has(child.id)) {
        result.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return result;
}

export interface DropTarget {
  parentId: string | null;
  index: number;
  depth: number;
}

function arrayMove<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// dnd-kit SortableTree 방식의 투영 — 세로 위치(overId 자리로 이동)가 형제 순서를,
// 가로 드래그 거리(depthDelta = 들여쓰기 칸 수)가 중첩 깊이를 정한다.
// rows는 '보이는 행에서 드래그 노드의 자손을 뺀 목록'(자손은 함께 움직인다).
// index는 서버 moveNote의 의미와 같다 — 이동 노드를 뺀 대상 형제 그룹 기준 삽입 위치.
export function projectDrop(
  rows: TreeRow[],
  activeId: string,
  overId: string,
  depthDelta: number,
): DropTarget | null {
  const activeIndex = rows.findIndex((row) => row.node.id === activeId);
  const overIndex = rows.findIndex((row) => row.node.id === overId);
  if (activeIndex < 0 || overIndex < 0) return null;

  const moved = arrayMove(rows, activeIndex, overIndex);
  const prev = overIndex > 0 ? moved[overIndex - 1] : null;
  const next = overIndex < moved.length - 1 ? moved[overIndex + 1] : null;

  // 깊이의 상한은 '바로 위 행의 자식'(prev.depth+1), 하한은 '바로 아래 행과 같은
  // 깊이' — 그보다 얕으면 아래 행이 남의 부모 밑으로 끌려 들어간다.
  const maxDepth = prev ? prev.depth + 1 : 0;
  const minDepth = next ? next.depth : 0;
  const depth = Math.min(Math.max(rows[activeIndex].depth + depthDelta, minDepth), maxDepth);

  // 부모 = 위쪽에서 가장 가까운 depth-1 행. 그보다 얕은 행을 먼저 만나면 그런 부모는
  // 없다(투영 불가).
  let parentId: string | null = null;
  if (depth > 0) {
    for (let i = overIndex - 1; i >= 0; i -= 1) {
      if (moved[i].depth === depth - 1) {
        parentId = moved[i].node.id;
        break;
      }
      if (moved[i].depth < depth - 1) return null;
    }
    if (parentId === null) return null;
  }

  // 삽입 index = 위쪽에 보이는 같은 부모·같은 깊이의 형제 수. 같은 부모의 형제는
  // 부모가 펼쳐져 있는 한 전부 보이므로(접힌 건 그 '자손'뿐) 세는 값이 정확하다.
  let index = 0;
  for (let i = 0; i < overIndex; i += 1) {
    const row = moved[i];
    if (row.node.id !== activeId && row.depth === depth && row.node.parentId === parentId) {
      index += 1;
    }
  }
  return { parentId, index, depth };
}

export interface TreeMove {
  id: string;
  parentId: string | null;
  index: number;
}

// 낙관적 이동 — 서버 moveNote와 같은 규칙(대상 그룹에서 자신을 빼고 index에 삽입,
// 그룹 내 position 0..n 재부여)으로 flat 목록을 다시 만든다. revalidated RSC가
// 도착했을 때 순서가 다르면 행이 점프하므로 규칙이 서버와 일치해야 한다.
export function applyMove(nodes: NoteTreeNode[], move: TreeMove): NoteTreeNode[] {
  const target = nodes.find((node) => node.id === move.id);
  if (!target) return nodes;
  // 자기 자신·자손 밑으로의 이동은 클라이언트에서도 거른다(서버는 cycle로 거부).
  if (move.parentId !== null && subtreeIds(nodes, move.id).has(move.parentId)) return nodes;

  // 전체 노드로 그룹핑한 뒤 이동 노드만 옛 그룹에서 빼서 대상 그룹에 끼운다.
  // 이동 노드를 목록에서 필터링해 놓고 그룹핑하면 그 자손들이 고아 폴백(루트)으로
  // 떨어져, 재조립이 자손 전체의 parentId를 null로 도장 찍는다(자체 리뷰 Finding 1).
  const byParent = childrenByParent(nodes);
  for (const group of byParent.values()) {
    const at = group.findIndex((node) => node.id === move.id);
    if (at >= 0) {
      group.splice(at, 1);
      break;
    }
  }
  const group = byParent.get(move.parentId) ?? [];
  if (!byParent.has(move.parentId)) byParent.set(move.parentId, group);
  group.splice(Math.max(0, Math.min(move.index, group.length)), 0, target);

  const result: NoteTreeNode[] = [];
  for (const [parentId, children] of byParent) {
    children.forEach((child, position) => result.push({ ...child, parentId, position }));
  }
  return result;
}
