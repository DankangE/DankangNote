'use client';

import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import type { Extension } from '@tiptap/core';
import type { Awareness } from 'y-protocols/awareness';
import type { CaretDirectory } from '@/features/notes/collab-identity';

/**
 * 남의 커서를 그리는 확장 (KAN-75).
 *
 * 이 파일이 따로 있는 이유는 타입 이음매 하나 때문이다 — 아래 CARET_RENDERERS 주석 참조.
 * 그 밖의 규칙은 하나다: **화면에 뜨는 이름은 directory에서만 나온다.** 확장이 넘겨주는
 * `user`(=보낸 쪽이 awareness에 채운 값)는 쳐다보지 않는다.
 */

/** 신원을 못 세운 커서의 자리. 지우는 대신 아무것도 안 그린다(아래 주석). */
function blankCaret(): HTMLElement {
  const empty = document.createElement('span');
  empty.setAttribute('style', 'display:none');
  return empty;
}

function buildCaret(directory: CaretDirectory, clientId: number): HTMLElement {
  const identity = directory.resolve(clientId);
  // 주인을 못 세운 커서는 그리지 않는다. '누군가'로 그리면 신원이 없는 커서가 정상 커서와
  // 같은 자리에 같은 모양으로 앉는다 — 이 기능에서 이름표는 장식이 아니라 내용이다.
  if (!identity) return blankCaret();

  const caret = document.createElement('span');
  caret.classList.add('collaboration-carets__caret');
  caret.setAttribute('style', `border-color: ${identity.color}`);

  const label = document.createElement('div');
  label.classList.add('collaboration-carets__label');
  label.setAttribute('style', `background-color: ${identity.color}`);
  // textContent — 이름은 Clerk에서 온 사용자 입력이라 innerHTML로 넣으면 그대로 XSS다.
  label.textContent = identity.name;

  caret.append(label);
  return caret;
}

function buildSelection(
  directory: CaretDirectory,
  clientId: number,
): { nodeName: string; class: string; style: string } {
  const identity = directory.resolve(clientId);
  if (!identity) {
    // 클래스도 색도 없이 — 데코레이션은 남지만 아무것도 칠하지 않는다.
    return { nodeName: 'span', class: '', style: '' };
  }
  return {
    nodeName: 'span',
    class: 'collaboration-carets__selection',
    // color-mix로 투명도를 준다 — 우리 색은 oklch라 y-prosemirror가 기대하는
    // `#rrggbb70` 꼬리표 방식을 쓸 수 없다.
    style: `background-color: color-mix(in oklch, ${identity.color} 28%, transparent)`,
  };
}

/**
 * 확장의 공개 타입은 `render(user)` 한 개짜리인데, 실제로는 y-tiptap의 yCursorPlugin이
 * **`(user, clientId)`로** 부른다(그 패키지의 JSDoc이 두 인자를 계약으로 적어 두었다).
 *
 * clientId 없이는 커서의 주인을 서명 쪽에서 되찾을 수 없고, 그게 이 기능의 전부다 —
 * 이름을 페이로드에서 읽는 순간 누구나 남의 이름표를 달 수 있게 된다(collab-identity.ts).
 * y-tiptap을 직접 부르는 길도 있었지만 그 패키지는 타입 선언을 싣지 않아 import 자체가
 * 통째로 any가 된다. 그래서 **라이브러리가 덜 적어 둔 인자를 되살리는 자리**로 여기 하나만
 * 두고, 값을 다른 타입으로 속이는 단언은 하지 않는다.
 */
type CaretRenderers = {
  render: (user: Record<string, unknown>, clientId: number) => HTMLElement;
  selectionRender: (
    user: Record<string, unknown>,
    clientId: number,
  ) => { nodeName: string; class: string; style: string };
};

type ConfigurableOptions = Parameters<typeof CollaborationCaret.configure>[0];

export function noteCollabCaret(awareness: Awareness, directory: CaretDirectory): Extension {
  const renderers: CaretRenderers = {
    render: (_user, clientId) => buildCaret(directory, clientId),
    selectionRender: (_user, clientId) => buildSelection(directory, clientId),
  };
  return CollaborationCaret.configure({
    // 확장이 요구하는 건 awareness 하나뿐이다(Hocuspocus provider의 그 필드).
    provider: { awareness },
    // **비워 둔다.** 이 값은 내 awareness 상태에 실려 남들에게 전달되는데, 받는 쪽은
    // 어차피 자기 프레즌스 명단에서 이름을 찾으므로 여기 뭘 넣어도 쓰이지 않는다.
    // 넣지 않는 편이 낫다 — 이름을 실어 보내지 않으면 신뢰할지 말지 고민할 값도 없다.
    user: {},
    ...(renderers as unknown as ConfigurableOptions),
  });
}
