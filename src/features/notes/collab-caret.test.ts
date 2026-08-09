// @vitest-environment happy-dom
// 진짜 Tiptap 에디터 두 개를 띄워 남의 커서가 화면에 그려지는 데까지 관통한다.
// 이 파일이 고정하는 건 하나다: **커서에 붙는 이름은 awareness 페이로드가 아니라
// 프레즌스에서 온다.**
//
// 에디터를 실제로 마운트하는 이유는 그 판정이 라이브러리 계약 위에 얹혀 있어서다. 커서를
// 그리는 콜백을 y-tiptap은 `(user, clientId)`로 부르는데 확장의 공개 타입에는 인자가 하나만
// 적혀 있다(collab-caret.ts의 CaretRenderers 주석). clientId가 정말 두 번째로 오는지는
// 타입이 보장해 주지 않으므로 여기서 보증한다 — 안 오면 신원 해석이 통째로 무너지고,
// 그때 화면에 뜨는 건 '이름 없는 커서'가 아니라 **보낸 쪽이 적어 보낸 이름**이 된다.
import { beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { buildNoteEditorExtensions } from './editor';
import { noteCollabCaret } from './collab-caret';
import { CaretDirectory } from './collab-identity';
import { NOTE_DOC_FIELD } from './doc-field';

const PEER = 'user_2';
const ME = 'user_1';

let doc: Y.Doc;
let awareness: Awareness;
let directory: CaretDirectory;
let editor: Editor;
let peerDoc: Y.Doc;
let peerAwareness: Awareness;
let peerEditor: Editor;

/** 브라우저 한 대 — 자기 Y.Doc·awareness·에디터를 갖는다. */
function mount(ydoc: Y.Doc, target: Awareness, dir: CaretDirectory): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      ...buildNoteEditorExtensions({ undoRedo: false }),
      Collaboration.configure({ document: ydoc, field: NOTE_DOC_FIELD }),
      noteCollabCaret(target, dir),
    ],
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  doc = new Y.Doc();
  awareness = new Awareness(doc);
  directory = new CaretDirectory();
  editor = mount(doc, awareness, directory);
  // 커서가 가리킬 자리가 있어야 데코레이션이 생긴다.
  editor.commands.setContent('<p>공동 편집</p>');

  peerDoc = new Y.Doc();
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(doc));
  peerAwareness = new Awareness(peerDoc);
  peerEditor = mount(peerDoc, peerAwareness, new CaretDirectory());
});

/**
 * 상대가 본문에 커서를 두고 그 상태를 우리에게 보낸다. claimedUser는 그가 awareness에
 * 적어 넣은 값 — 실제 앱에서 보낸 쪽이 마음대로 채울 수 있는 자리가 정확히 여기다.
 */
async function peerPlacesCursor(claimedUser?: Record<string, string>): Promise<void> {
  peerEditor.view.dom.focus();
  peerEditor.commands.setTextSelection(2);
  if (claimedUser) {
    peerAwareness.setLocalStateField('user', claimedUser);
  }
  // 문서 델타는 양방향으로 흐른다(실제 앱에서는 doc 채널이 한다) — 상대 커서가 가리키는
  // 항목이 우리 문서에 없으면 위치 자체가 해석되지 않는다.
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peerDoc));
  applyAwarenessUpdate(
    awareness,
    encodeAwarenessUpdate(peerAwareness, [peerAwareness.clientID]),
    'remote',
  );
  // 위젯 DOM은 다음 틱의 뷰 갱신에서 만들어진다.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 화면에 실제로 그려진 커서 이름표. */
function caretLabels(): string[] {
  return [...editor.view.dom.querySelectorAll('.collaboration-carets__label')].map(
    (node) => node.textContent ?? '',
  );
}

describe('남의 커서 렌더 (KAN-75)', () => {
  it('프레즌스가 알려준 이름으로 커서가 뜬다', async () => {
    directory.replaceMembers([{ id: PEER, name: '홍 길동', imageUrl: null }]);
    directory.bind([peerAwareness.clientID], PEER);

    await peerPlacesCursor();

    expect(caretLabels()).toEqual(['홍 길동']);
  });

  it('페이로드에 적어 보낸 이름은 화면에 오지 않는다 — 남의 이름표를 달 수 없다', async () => {
    directory.replaceMembers([{ id: PEER, name: '홍 길동', imageUrl: null }]);
    directory.bind([peerAwareness.clientID], PEER);

    await peerPlacesCursor({ name: '단 강(관리자)', color: '#ff0000' });

    expect(caretLabels()).toEqual(['홍 길동']);
  });

  it('주인을 못 세운 커서는 아예 그리지 않는다', async () => {
    // 원격 상태는 도착했지만 프레즌스에도 없고 bind도 안 됐다 — 신원이 없는 커서다.
    await peerPlacesCursor({ name: '아무개' });

    expect(caretLabels()).toEqual([]);
  });

  it('나간 사람의 커서는 즉시 사라진다 — 30초 타임아웃을 기다리지 않는다', async () => {
    directory.replaceMembers([{ id: PEER, name: '홍 길동', imageUrl: null }]);
    directory.bind([peerAwareness.clientID], PEER);
    await peerPlacesCursor();
    expect(caretLabels()).toEqual(['홍 길동']);

    // 훅이 member_removed에서 하는 일 그대로 — **두 동작은 짝이다.** 명단에서만 빼면
    // 데코레이션을 다시 계산할 계기가 없어 이미 그려진 커서가 그대로 남는다.
    const orphaned = directory.removeMember(PEER);
    removeAwarenessStates(awareness, orphaned, 'purge');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(caretLabels()).toEqual([]);
  });

  it('이름은 textContent로 넣는다 — 표시 이름은 사용자 입력이다', async () => {
    directory.replaceMembers([{ id: PEER, name: '<img src=x onerror=alert(1)>', imageUrl: null }]);
    directory.bind([peerAwareness.clientID], PEER);

    await peerPlacesCursor();

    expect(editor.view.dom.querySelector('.collaboration-carets__label img')).toBeNull();
    expect(caretLabels()).toEqual(['<img src=x onerror=alert(1)>']);
  });

  it('내 커서는 내 화면에 그리지 않는다', async () => {
    directory.replaceMembers([{ id: ME, name: '단 강', imageUrl: null }]);
    directory.bind([awareness.clientID], ME);

    editor.view.dom.focus();
    editor.commands.setTextSelection(2);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(caretLabels()).toEqual([]);
  });
});
