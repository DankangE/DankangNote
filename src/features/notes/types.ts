export type { Note } from '@/server/generated/prisma/client';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
