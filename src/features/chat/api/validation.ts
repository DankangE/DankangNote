import { z } from '@/lib/zod';

// 액션('use server')과 조회(server-only)가 공유하는 스키마 — 'use server' 모듈은
// async 함수만 export할 수 있어 스키마를 별도 모듈로 둔다.

// cuid는 ~25자 — 넉넉한 상한만 둔다(비정상적으로 긴 입력이 쿼리에 닿지 않게).
const idSchema = z.string().min(1, 'id가 필요합니다.').max(100, 'id가 유효하지 않습니다.');

export const messageBodySchema = z
  .string()
  .trim()
  .min(1, '메시지를 입력하세요.')
  .max(4000, '메시지는 4000자 이하여야 합니다.');

// 채널 이름은 슬랙처럼 `#이름`으로 부르는 식별자다. 공백은 하이픈으로 접고 소문자로
// 정규화한다 — 'General'과 'general'이 다른 채널로 갈라지면 멘탈 모델이 깨진다.
// 한글을 그대로 허용하되(팀 언어), 이름 안에서 의미를 갖는 구분자는 하이픈·밑줄만 남긴다.
const CHANNEL_NAME_PATTERN = /^[가-힣a-z0-9_-]+$/;

const channelName = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/\s+/g, '-'))
  .pipe(
    z
      .string()
      .min(1, '채널 이름을 입력하세요.')
      .max(40, '채널 이름은 40자 이하여야 합니다.')
      .regex(CHANNEL_NAME_PATTERN, '채널 이름은 한글·영문 소문자·숫자·하이픈만 쓸 수 있어요.'),
  );

// 주제는 비워둘 수 있다 — 빈 문자열은 null로 접어 DB에 '없음'으로 저장한다.
const channelTopic = z
  .string()
  .trim()
  .max(200, '채널 주제는 200자 이하여야 합니다.')
  .transform((value) => value || null)
  .nullable()
  .default(null);

export const channelRefSchema = z.object({ id: idSchema });
export const sendMessageSchema = z.object({ channelId: idSchema, body: messageBodySchema });
// before는 '이 메시지보다 과거'를 가리키는 커서 — 화면에 남아 있는 가장 오래된 메시지 id다.
export const olderMessagesSchema = z.object({ channelId: idSchema, before: idSchema });
export const createChannelSchema = z.object({
  name: channelName,
  topic: channelTopic,
  isPrivate: z.boolean().default(false),
});
export const updateChannelSchema = z.object({
  id: idSchema,
  name: channelName,
  topic: channelTopic,
});
export const inviteSchema = z.object({ id: idSchema, userId: idSchema });
