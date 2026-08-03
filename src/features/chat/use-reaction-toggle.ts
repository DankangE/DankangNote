'use client';

import { useCallback, useRef } from 'react';
import { toggleReactionAction } from '@/features/chat/api/actions';
import {
  appliedVersion,
  applyReaction,
  hasMyReaction,
  markMyReaction,
  reactionKey,
  serverOverwrote,
  setMyReaction,
  type RoomMessage,
} from '@/features/chat/room-state';
import type { ReactionDelta } from '@/features/chat/types';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

/**
 * 리액션 토글의 공용 규칙 (KAN-31). 본문 목록(ChatRoom)과 스레드 패널이 같은 것을 쓴다 —
 * 두 곳에 따로 두면 낙관·롤백 규칙이 갈라지고, 그 차이는 실패 경로에서만 드러나 늦게 발견된다.
 *
 * apply는 '메시지 목록을 이렇게 바꿔라'를 받는다. 본문은 목록 하나지만 패널은 루트와 답글이
 * 서로 다른 state라, 목록 변환 함수로 받아야 양쪽에 같은 순수 함수를 돌릴 수 있다.
 */
export function useReactionToggle({
  viewerId,
  apply,
  onConfirmed,
  onError,
}: {
  viewerId: string;
  apply: (update: (list: RoomMessage[]) => RoomMessage[]) => void;
  /** 서버가 확정한 델타 — 호출부가 다른 화면(본문 목록 등)에도 퍼뜨린다. */
  onConfirmed: (delta: ReactionDelta) => void;
  onError: (message: string | null) => void;
}) {
  // 응답을 기다리는 사이의 같은 키 재클릭은 버린다. 두 요청이 서로 순서가 뒤집혀 도착하면
  // 화면은 '눌린 상태'인데 DB에는 없는(또는 그 반대) 어긋남이 남고, 그 뒤로는 클릭 방향이
  // 통째로 반대가 된다 — '취소'를 눌렀는데 리액션이 달린다.
  const inFlight = useRef(new Set<string>());

  const toggle = useCallback(
    async (target: RoomMessage | undefined, emoji: string) => {
      if (!target) return;
      const key = reactionKey(target.id, emoji);
      if (inFlight.current.has(key)) return;

      const next = !hasMyReaction(target, emoji);
      onError(null);
      // 이번 왕복의 기준선. 롤백 때 이 번호보다 올라가 있으면 서버 값이 내 낙관 위를
      // 덮은 것이다(KAN-52). ref로 '델타가 왔는가'를 세던 것을 상태에서 읽는 것으로
      // 바꿨다 — 역순 배달로 **버려진** 델타는 화면을 바꾸지 않았는데도 ref는 왔다고
      // 기록했고, 그러면 롤백이 count를 안 되돌려 1만큼 어긋난 채 남았다.
      const since = appliedVersion(target, emoji);
      inFlight.current.add(key);
      apply((list) => setMyReaction(list, target.id, emoji, viewerId, next));

      const rollback = (message: string) => {
        apply((list) =>
          serverOverwrote(list, target.id, emoji, since)
            ? markMyReaction(list, target.id, emoji, !next)
            : setMyReaction(list, target.id, emoji, viewerId, !next),
        );
        onError(message);
      };

      try {
        const result = await toggleReactionAction({ messageId: target.id, emoji });
        if (!result.ok) {
          rollback(result.error);
          return;
        }
        apply((list) => applyReaction(list, result.data, viewerId));
        onConfirmed(result.data);
      } catch {
        rollback(GENERIC_ERROR);
      } finally {
        inFlight.current.delete(key);
      }
    },
    [apply, onConfirmed, onError, viewerId],
  );

  return { toggle };
}
