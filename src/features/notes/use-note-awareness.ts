'use client';

import { useEffect, useState } from 'react';
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
  type Awareness,
} from 'y-protocols/awareness';
import {
  acquirePusher,
  releasePusher,
  subscribeShared,
  unsubscribeShared,
} from '@/features/chat/pusher-connection';
import { NOTE_AWARENESS_EVENT, notePresenceChannel } from '@/features/notes/realtime';
import { CaretDirectory } from '@/features/notes/collab-identity';
import { toBase64, toBytes } from '@/features/notes/binary';
import {
  presentMember,
  sortMembers,
  withMember,
  withoutMember,
  type PresentMember,
  type PusherEventMetadata,
  type PusherMember,
  type PusherMembers,
} from '@/features/realtime/presence-members';

/**
 * 커서 상태를 모아 보내는 간격 (KAN-75). 문서 델타(300ms)보다 짧다 — 커서는 늦으면
 * 바로 티가 나고 페이로드가 작다. 그래도 타건마다 보내지는 않는다: Pusher는 클라이언트
 * 이벤트에 초당 상한을 두고, 넘긴 건 그냥 버려진다.
 *
 * 버려져도 무해한 이유는 awareness가 **절대 상태**여서다(규약 12) — 다음 틱이 최신 위치를
 * 통째로 다시 싣는다. 역순 배달도 마찬가지로 다음 틱이 덮는다.
 */
const AWARENESS_FLUSH_MS = 80;

/**
 * 이 문서를 함께 보고 있는 사람들과 그들의 커서 (KAN-75).
 *
 * 문서 델타(useCollaborativeDoc)와 **채널도 경로도 다르다** — 이유는 realtime.ts의
 * 프레즌스 접두사 주석에 있다. 여기서 오가는 건 접속 중에만 사는 값이라 저장되지 않는다.
 *
 * 반환하는 directory가 이 훅의 핵심이다: 커서에 붙는 이름은 **awareness 페이로드가 아니라**
 * 서버가 서명한 프레즌스 정보에서 나온다(collab-identity.ts).
 */
export function useNoteAwareness(
  noteId: string,
  local: Awareness,
): {
  members: readonly PresentMember[];
  directory: CaretDirectory;
} {
  const [members, setMembers] = useState<readonly PresentMember[]>([]);
  // 생성자가 순수해서 StrictMode의 이중 호출이 아무것도 흘리지 않는다.
  const [directory] = useState(() => new CaretDirectory());

  useEffect(() => {
    const client = acquirePusher();
    const channelName = notePresenceChannel(noteId);
    const channel = client ? subscribeShared(client, channelName) : null;

    /** 원격에서 온 적용 표시 — 이 origin의 변경만 발신자에게 귀속시킨다. */
    const REMOTE = Symbol('remote');
    /**
     * 우리가 직접 걷어낸 표시. 이 origin의 removed는 **주인 기록을 지우지 않는다** —
     * 가로채기 시도에 휩쓸려 지워진 진짜 주인이 다시 보낼 때 같은 번호로 다시 잡혀야 한다.
     */
    const PURGE = Symbol('purge');

    // 방금 apply가 건드린 clientId. applyAwarenessUpdate가 'update'를 동기로 쏘므로
    // 그 사이에만 채워진다.
    let applied: number[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    function send(): void {
      // **내 상태만** 싣는다. 받은 걸 되쏘면 같은 값이 사람 수만큼 왕복하고, 남의 상태를
      // 내 서명으로 실어 나르는 셈이라 아래 신원 판정의 근거도 무너진다.
      const update = encodeAwarenessUpdate(local, [local.clientID]);
      channel?.trigger(NOTE_AWARENESS_EVENT, { update: toBase64(update) });
    }

    function scheduleSend(): void {
      if (!channel || timer) return;
      timer = setTimeout(() => {
        timer = null;
        send();
      }, AWARENESS_FLUSH_MS);
    }

    function onAwarenessUpdate(
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ): void {
      if (origin === 'local') {
        scheduleSend();
        return;
      }
      if (origin === REMOTE) {
        applied.push(...changes.added, ...changes.updated);
      }
      // 원격 이탈·타임아웃(30초)으로 사라진 번호는 잊는다 — 재접속하면 새 번호가 온다.
      if (origin !== PURGE && changes.removed.length > 0) {
        directory.unbind(changes.removed);
      }
    }

    function onAwarenessEvent(data: unknown, metadata: PusherEventMetadata): void {
      // 신원의 유일한 근거. Pusher가 구독 서명에서 뽑아 붙이므로 보낸 쪽이 못 바꾼다.
      const userId = metadata?.user_id;
      // 프레즌스 명단에 없는 사람은 버린다 — 이 채널을 열어 두지 않은 사람의 커서를
      // 그릴 이유가 없고, 명단이 곧 이름의 출처라 없으면 어차피 못 그린다.
      if (typeof userId !== 'string' || !directory.hasMember(userId)) return;
      const payload = data as { update?: unknown };
      if (typeof payload?.update !== 'string') return;

      applied = [];
      applyAwarenessUpdate(local, toBytes(payload.update), REMOTE);
      // 내 번호는 주인을 기록하지 않는다. 남이 내 clientID를 실어 보내면 y-protocols가
      // 상태 자체는 막지 않는데(지우는 것만 막는다), 그걸 그대로 묶으면 내 번호의 주인이
      // 남이 된다. 내 커서는 어차피 안 그려지므로(y-tiptap이 자기 번호를 거른다) 여기서
      // 빼는 걸로 충분하다.
      const rejected = directory.bind(
        applied.filter((clientId) => clientId !== local.clientID),
        userId,
      );
      // 남의 번호를 실어 온 자리는 상태째 걷어낸다. 진짜 주인의 커서가 잠깐 사라지지만,
      // 잘못된 이름표를 다는 것보다 안 그리는 쪽이 낫다(fail-closed).
      if (rejected.length > 0) {
        removeAwarenessStates(local, rejected, PURGE);
      }
    }

    function onSubscribed(current: PusherMembers): void {
      const list: PresentMember[] = [];
      current.each((member) => {
        const parsed = presentMember(member?.id, member?.info);
        if (parsed) list.push(parsed);
      });
      const sorted = sortMembers(list);
      directory.replaceMembers(sorted);
      setMembers(sorted);
      // 이미 와 있던 사람들에게 내 존재를 알린다 — awareness에는 서버가 들고 있는
      // 스냅샷이 없어서, 아무도 먼저 말해 주지 않으면 서로를 영영 모른다.
      send();
    }

    function onMemberAdded(member: PusherMember): void {
      const parsed = presentMember(member?.id, member?.info);
      if (!parsed) return;
      directory.addMember(parsed);
      setMembers((prev) => withMember(prev, parsed));
      // 새로 온 사람은 내 커서를 모른다. 같은 이유로 이쪽에서 다시 알린다.
      send();
    }

    function onMemberRemoved(member: PusherMember): void {
      const id = member?.id;
      if (typeof id !== 'string') return;
      // 이 사람이 쓰던 커서를 **즉시** 지운다. awareness의 자체 타임아웃만 믿으면
      // 탭이 죽은 사람의 커서가 30초 동안 남아 아직 보고 있는 것처럼 보인다.
      const orphaned = directory.removeMember(id);
      if (orphaned.length > 0) {
        removeAwarenessStates(local, orphaned, PURGE);
      }
      setMembers((prev) => withoutMember(prev, id));
    }

    local.on('update', onAwarenessUpdate);
    channel?.bind('pusher:subscription_succeeded', onSubscribed);
    channel?.bind('pusher:member_added', onMemberAdded);
    channel?.bind('pusher:member_removed', onMemberRemoved);
    channel?.bind(NOTE_AWARENESS_EVENT, onAwarenessEvent);

    return () => {
      if (timer) clearTimeout(timer);
      channel?.unbind('pusher:subscription_succeeded', onSubscribed);
      channel?.unbind('pusher:member_added', onMemberAdded);
      channel?.unbind('pusher:member_removed', onMemberRemoved);
      channel?.unbind(NOTE_AWARENESS_EVENT, onAwarenessEvent);
      local.off('update', onAwarenessUpdate);
      // Awareness 자체는 여기서 destroy하지 않는다 — 만든 쪽(useCollaborativeDoc)이
      // Y.Doc과 함께 정리한다. 남들은 프레즌스 이탈로 내 커서를 즉시 지운다.
      if (client) {
        unsubscribeShared(client, channelName);
        releasePusher();
      }
      // 구독이 끊긴 뒤에도 남아 있으면 방금 떠난 문서의 접속자가 그대로 보인다.
      setMembers([]);
    };
  }, [noteId, local, directory]);

  return { members, directory };
}
