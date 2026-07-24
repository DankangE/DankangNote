'use server';

import { guarded, parseOrError } from '@/lib/action-result';
import { resolveOrg } from '@/server/auth';
import * as boardService from '@/server/services/board';
import type { ActionResult } from '@/lib/action-result';
import type { BoardCardView, BoardColumnView, BoardView } from '@/features/board/types';
import {
  cardRefSchema,
  columnRefSchema,
  createCardSchema,
  createColumnSchema,
  moveCardSchema,
  renameColumnSchema,
} from './validation';

// Server Action은 클라이언트가 직접 POST할 수 있는 공개 엔드포인트다. 진입부에서
// 인증·조직 확인을 zod 검증보다 먼저 수행한다(backend.md: 진입부 auth). 보드 상태는
// 클라이언트가 로드 후 자체 관리하므로 revalidatePath 없이 영속화만 한다(KAN-17).

// 낙관적 변이 실패 시 클라이언트가 서버 진실로 되돌리기 위한 재조회. 전체 스냅샷 복원은
// 그 사이 성공한 다른 변이를 덮어쓰므로, 실패 경로는 이걸로 재동기화한다(KAN-17 자체 리뷰).
export async function refreshBoardAction(): Promise<ActionResult<BoardView>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  return guarded('board.refresh', async () => {
    const board = await boardService.listBoard(org.orgId);
    return { ok: true, data: board };
  });
}

export async function createColumnAction(input: unknown): Promise<ActionResult<BoardColumnView>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(createColumnSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('board.createColumn', async () => {
    const column = await boardService.createColumn(org.orgId, parsed.data.name);
    return { ok: true, data: column };
  });
}

export async function renameColumnAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(renameColumnSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('board.renameColumn', async () => {
    const ok = await boardService.renameColumn(org.orgId, parsed.data.id, parsed.data.name);
    if (!ok) {
      return { ok: false, error: '컬럼을 찾을 수 없습니다.' };
    }
    return { ok: true, data: { id: parsed.data.id } };
  });
}

export async function deleteColumnAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(columnRefSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('board.deleteColumn', async () => {
    const ok = await boardService.deleteColumn(org.orgId, parsed.data.id);
    if (!ok) {
      return { ok: false, error: '컬럼을 찾을 수 없습니다.' };
    }
    return { ok: true, data: { id: parsed.data.id } };
  });
}

export async function createCardAction(input: unknown): Promise<ActionResult<BoardCardView>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(createCardSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('board.createCard', async () => {
    const card = await boardService.createCard(
      org.orgId,
      org.userId,
      parsed.data.columnId,
      parsed.data.text,
    );
    if (!card) {
      return { ok: false, error: '컬럼을 찾을 수 없습니다.' };
    }
    return { ok: true, data: card };
  });
}

export async function deleteCardAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(cardRefSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('board.deleteCard', async () => {
    const ok = await boardService.deleteCard(org.orgId, parsed.data.id);
    if (!ok) {
      return { ok: false, error: '카드를 찾을 수 없습니다.' };
    }
    return { ok: true, data: { id: parsed.data.id } };
  });
}

export async function moveCardAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const org = await resolveOrg();
  if ('error' in org) {
    return { ok: false, error: org.error };
  }

  const parsed = parseOrError(moveCardSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return guarded('board.moveCard', async () => {
    const ok = await boardService.moveCard(
      org.orgId,
      parsed.data.cardId,
      parsed.data.toColumnId,
      parsed.data.orderedCardIds,
    );
    if (!ok) {
      return { ok: false, error: '카드를 이동할 수 없습니다.' };
    }
    return { ok: true, data: { id: parsed.data.cardId } };
  });
}
