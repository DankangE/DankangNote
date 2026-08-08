'use client';

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import {
  acquirePusher,
  releasePusher,
  subscribeShared,
  unsubscribeShared,
} from '@/features/chat/pusher-connection';
import {
  NOTE_DOC_RESYNC_EVENT,
  NOTE_DOC_UPDATE_EVENT,
  noteDocChannel,
} from '@/features/notes/realtime';

/**
 * 로컬 편집을 모아 보내는 간격 (KAN-39). 타건마다 보내면 요청이 초당 수십 건 나가고,
 * 너무 길게 잡으면 상대 화면에서 글자가 뭉텅이로 튄다. Yjs 델타는 합칠 수 있으므로
 * (mergeUpdates) 이 창 안의 편집은 한 번에 나간다.
 */
const FLUSH_INTERVAL_MS = 300;

export type CollabStatus = 'loading' | 'ready' | 'error';

/**
 * 이 노트의 공동 편집 문서를 연다.
 *
 * 반환하는 Y.Doc은 **서버 상태를 적용한 뒤에만** 내놓는다. 빈 문서를 먼저 넘기면 Tiptap이
 * 그걸로 에디터를 채운 뒤 서버 상태가 도착해 두 벌이 겹친다 — 사용자에게는 본문이 두 번
 * 나온 것으로 보인다.
 *
 * 원격에서 온 업데이트는 origin을 붙여 적용한다. 안 그러면 받은 업데이트가 다시 로컬 변경
 * 으로 잡혀 서버로 되돌아가고, 두 편집자 사이에서 무한히 왕복한다.
 */
export function useCollaborativeDoc(noteId: string): { doc: Y.Doc | null; status: CollabStatus } {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [status, setStatus] = useState<CollabStatus>('loading');

  useEffect(() => {
    const ydoc = new Y.Doc();
    const controller = new AbortController();
    const client = acquirePusher();
    const channelName = noteDocChannel(noteId);
    const channel = client ? subscribeShared(client, channelName) : null;
    let disposed = false;

    /** 원격 적용 표시 — 이 origin으로 들어온 변경은 서버로 되돌려 보내지 않는다. */
    const REMOTE = Symbol('remote');

    async function pullSnapshot(): Promise<boolean> {
      const response = await fetch(`/api/notes/${noteId}/doc`, { signal: controller.signal });
      if (!response.ok) return false;
      const body = (await response.json()) as { update: string };
      Y.applyUpdate(ydoc, toBytes(body.update), REMOTE);
      return true;
    }

    // 보낼 것을 모아 두는 큐. 창이 닫힐 때 하나로 합쳐 보낸다.
    let pending: Uint8Array[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function flush(): Promise<void> {
      timer = null;
      if (pending.length === 0) return;
      const merged = Y.mergeUpdates(pending);
      pending = [];
      try {
        await fetch(`/api/notes/${noteId}/doc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            update: toBase64(merged),
            socketId: client?.connection.socket_id,
          }),
          signal: controller.signal,
        });
      } catch {
        // 보내지 못한 편집은 되돌리지 않는다 — 화면에는 남아 있고, 다음 편집이 나갈 때
        // 그 델타까지 함께 실린다(Yjs 상태 벡터가 아니라 델타를 쌓고 있으므로 이번 건이
        // 유실되면 그 편집은 서버에 없다). 재접속 시 스냅샷을 다시 받아 어긋남을 좁힌다.
        if (!disposed) queueResync();
      }
    }

    function onLocalUpdate(update: Uint8Array, origin: unknown): void {
      if (origin === REMOTE) return;
      pending.push(update);
      timer ??= setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
    }

    let resyncing = false;
    function queueResync(): void {
      if (resyncing || disposed) return;
      resyncing = true;
      void pullSnapshot()
        .catch(() => false)
        .finally(() => {
          resyncing = false;
        });
    }

    function onRemoteUpdate(data: unknown): void {
      const payload = data as { update?: unknown };
      if (typeof payload?.update !== 'string') return;
      Y.applyUpdate(ydoc, toBytes(payload.update), REMOTE);
    }

    channel?.bind(NOTE_DOC_UPDATE_EVENT, onRemoteUpdate);
    channel?.bind(NOTE_DOC_RESYNC_EVENT, queueResync);

    void pullSnapshot()
      .then((ok) => {
        if (disposed) return;
        // 스냅샷을 받은 **뒤에** 로컬 변경을 듣기 시작한다 — 먼저 붙이면 서버 상태 적용이
        // 로컬 변경으로 잡혀 그대로 서버에 되돌아간다.
        ydoc.on('update', onLocalUpdate);
        setDoc(ydoc);
        setStatus(ok ? 'ready' : 'error');
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });

    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      ydoc.off('update', onLocalUpdate);
      channel?.unbind(NOTE_DOC_UPDATE_EVENT, onRemoteUpdate);
      channel?.unbind(NOTE_DOC_RESYNC_EVENT, queueResync);
      if (client) {
        unsubscribeShared(client, channelName);
        releasePusher();
      }
      ydoc.destroy();
    };
  }, [noteId]);

  return { doc, status };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
