import { z } from '@/lib/zod';

export const messageBodySchema = z
  .string()
  .trim()
  .min(1, '메시지를 입력하세요.')
  .max(4000, '메시지는 4000자 이하여야 합니다.');
