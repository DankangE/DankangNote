import { z } from '@/lib/zod';

// 액션('use server')과 조회(server-only)가 공유하는 스키마 — 'use server' 모듈은
// async 함수만 export할 수 있어 별도 모듈로 둔다(chat과 같은 구조).

const idSchema = z.string().min(1, 'id가 필요합니다.').max(100, 'id가 유효하지 않습니다.');

/** before는 '이 알림보다 과거'를 가리키는 커서 — 화면에 남은 가장 오래된 알림 id다. */
export const notificationPageSchema = z.object({ before: idSchema.optional() });

/**
 * 읽음 처리. ids가 없으면 '지금 보이는 안읽음 전부'다.
 * 상한을 두는 이유는 목록 한 페이지분을 한 번에 처리하는 것이 이 화면의 최대치라서다.
 */
export const markReadSchema = z.object({ ids: z.array(idSchema).max(100).optional() });
