import 'server-only';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MAX_ATTACHMENT_BYTES } from '@/features/chat/attachments';

// S3 호환 오브젝트 스토리지 (KAN-35). 로컬은 docker-compose의 MinIO, 스테이징은 관리형
// S3 호환 서비스로 env만 바꿔 간다 — Vercel Blob을 안 쓴 이유는 로컬 개발에도 Vercel 계정
// 토큰이 필요해서다(그 계정 연결이 곧 KAN-27의 선행 조건이라, 스토리지가 배포를 기다리게 된다).
//
// env 5종이 모두 있어야 첨부가 켜진다. 없으면 null — 채팅의 나머지는 그대로 동작하고
// 첨부 버튼·presign 라우트만 비활성화된다(pusher.ts와 같은 키 없는 로컬 개발 허용).
const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const bucket = process.env.S3_BUCKET;

const configured = endpoint && region && accessKeyId && secretAccessKey && bucket;

export const storage: { client: S3Client; bucket: string } | null = configured
  ? {
      client: new S3Client({
        endpoint,
        region,
        credentials: { accessKeyId, secretAccessKey },
        // MinIO는 가상 호스트 스타일(bucket.host)을 못 쓴다 — 경로 스타일(host/bucket)로
        // 고정한다. R2·S3에서도 경로 스타일은 동작하므로 스테이징에서 갈라질 것이 없다.
        forcePathStyle: true,
      }),
      bucket,
    }
  : null;

/** 업로드 presign 유효 시간. 큰 파일의 느린 회선을 감안해 넉넉히 둔다. */
const UPLOAD_TTL_SECONDS = 600;
/**
 * 다운로드 presign 유효 시간. 우리 라우트가 매 요청 접근 판정 후 새로 발급하므로 짧을수록
 * 좋다 — 이 URL이 밖으로 새도(주소 복사·리퍼러) 이 시간 뒤에는 죽는다.
 */
const DOWNLOAD_TTL_SECONDS = 60;

export interface UploadTicket {
  url: string;
  fields: Record<string, string>;
}

/**
 * 브라우저가 스토리지에 **직접** 올릴 presigned POST를 만든다.
 *
 * 서버를 거치지 않는 이유: 서버리스(Vercel)의 요청 본문 상한이 4.5MB라, 프록시 업로드는
 * 그 값이 곧 파일 상한이 된다. PUT이 아니라 POST인 이유: presigned PUT은 Content-Length가
 * 서명에 들어가지 않아 선언보다 큰 파일을 스토리지가 거부하지 못한다. POST 정책의
 * content-length-range가 크기 상한을, Content-Type eq 조건이 타입 고정을 **스토리지
 * 수준에서** 강제한다 — 클라이언트 검증은 전부 편의일 뿐이다.
 */
export function presignAttachmentUpload(
  key: string,
  contentType: string,
): Promise<UploadTicket> | null {
  if (!storage) {
    return null;
  }
  return createPresignedPost(storage.client, {
    Bucket: storage.bucket,
    Key: key,
    Conditions: [
      ['content-length-range', 1, MAX_ATTACHMENT_BYTES],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
    Expires: UPLOAD_TTL_SECONDS,
  });
}

/**
 * 다운로드용 presigned GET. inline이 아니면 Content-Disposition: attachment를 강제해
 * 브라우저가 내용을 실행 문맥으로 열지 않게 한다(SVG·HTML 류의 저장형 XSS 차단).
 * Content-Type도 행에 저장된 값으로 덮는다 — 업로드 시점에 서명으로 고정된 값이라
 * 스토리지의 것과 같지만, 응답 헤더의 근거를 우리 DB 한 곳으로 모은다.
 */
export function presignAttachmentDownload(
  key: string,
  fileName: string,
  contentType: string,
  inline: boolean,
): Promise<string> | null {
  if (!storage) {
    return null;
  }
  // 한글 파일명은 RFC 5987 인코딩(filename*)으로 싣는다. ASCII fallback의 따옴표·제어문자는
  // 헤더를 깨뜨릴 수 있어 안전한 문자만 남긴다.
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const disposition = `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  return getSignedUrl(
    storage.client,
    new GetObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: disposition,
    }),
    { expiresIn: DOWNLOAD_TTL_SECONDS },
  );
}
