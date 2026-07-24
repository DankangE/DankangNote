import { z } from '@/lib/zod';

// 액션('use server')과 조회(server-only)가 공유하는 스키마 — 'use server' 모듈은
// async 함수만 export할 수 있어 스키마를 별도 모듈로 둔다.

const idSchema = z.string().min(1, 'id가 필요합니다.');
const columnName = z
  .string()
  .trim()
  .min(1, '컬럼 이름을 입력하세요.')
  .max(50, '컬럼 이름은 50자 이하여야 합니다.');
const cardText = z
  .string()
  .trim()
  .min(1, '카드 내용을 입력하세요.')
  .max(500, '카드 내용은 500자 이하여야 합니다.');

export const createColumnSchema = z.object({ name: columnName });
export const renameColumnSchema = z.object({ id: idSchema, name: columnName });
export const columnRefSchema = z.object({ id: idSchema });
export const createCardSchema = z.object({ columnId: idSchema, text: cardText });
export const cardRefSchema = z.object({ id: idSchema });
export const moveCardSchema = z.object({
  cardId: idSchema,
  toColumnId: idSchema,
  // 이동 후 대상 컬럼의 최종 카드 순서. 한 컬럼의 카드 수 상한을 넉넉히 잡는다(MVP).
  orderedCardIds: z.array(idSchema).min(1).max(500),
});
