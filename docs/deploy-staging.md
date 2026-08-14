# 스테이징 배포 절차 (KAN-27)

계정이 붙는 순간 **값만 채우면 배포되도록** 미리 확정해 둔 문서다(KAN-59에서 절차,
KAN-77에서 코드). 아직 배포된 환경은 없다 — 여기 적힌 것 중 실제 배포에서 확인된 것은
아직 없고, 확인되면 이 문서를 고친다.

배포가 필요한 이유는 하나다. **Clerk 웹훅은 localhost로 직접 받을 수 없어** 미러 동기화
(KAN-11)와 순서 역전 가드(KAN-12)가 실환경에서 한 번도 안 돌았다.

## 0. 필요한 계정

확정한 조합이다(2026-08-12). 전부 무료 티어로 시작한다.

| 대상 | 무엇 | 왜 이걸로 |
| --- | --- | --- |
| **Vercel** | 앱 호스팅 | Next 16 네이티브. PR마다 프리뷰 URL |
| **Neon** | 관리형 Postgres | 풀러·직결 문자열을 짝으로 주고, **DB 브랜칭**으로 프리뷰 DB 분리가 자동 |
| **Cloudflare R2** | 첨부 스토리지 (S3 호환) | egress 무료. 로컬 MinIO와 같은 코드가 그대로 돈다 |
| Clerk | 인증·조직 | 이미 쓴다. **배포용 인스턴스 키**가 따로 필요하다 |
| Pusher | 실시간 | 이미 쓴다. 같은 앱을 재사용해도 된다(cluster 확인) |

## 1. 데이터베이스 (Neon)

1. Neon 프로젝트를 만든다. **리전은 Vercel 함수 리전과 맞춘다** — 엇갈리면 쿼리마다
   대륙을 왕복한다. Vercel 쪽 리전은 프로젝트 Settings > Functions에서 확인한다.
2. **Neon 콘솔 > Integrations > Vercel**로 통합을 설치하고 Vercel 프로젝트와 잇는다.
   이 통합이 하는 일이 이 문서에서 가장 중요하다:
   - 배포마다 `DATABASE_URL`(풀러 경유)과 `DATABASE_URL_UNPOOLED`(직결)를 **짝으로** 주입한다.
   - PR 프리뷰 배포에는 `preview/<브랜치명>` Neon 브랜치를 새로 떠서 그 짝을 준다.
     → **프리뷰가 스테이징 DB를 건드리지 않는다.** 이걸 안 쓰면 아래 "정해 둔 판단"의
     프리뷰 문제를 손으로 풀어야 한다.
3. 두 키는 **Vercel 환경변수에 손으로 넣지 않는다.** 통합이 배포별로 주입하는 값이라,
   손으로 박으면 고정값이 되어 프리뷰 앱은 프리뷰 DB를 보는데 그 빌드는 스테이징 DB를
   마이그레이션하는 엇갈림이 난다(`prisma.config.ts` 주석).
4. 스키마는 첫 배포 빌드가 적용한다 — `vercel.json`의 빌드 커맨드가 `pnpm prisma migrate
   deploy`를 `next build` 앞에 세운다.

> 앱은 풀러, 마이그레이션은 직결로 갈린다. `src/server/db.ts`는 `DATABASE_URL`을,
> `prisma.config.ts`는 `DATABASE_URL_UNPOOLED`(없으면 `DATABASE_URL`)를 읽는다. 마이그레이션이
> 직결이어야 하는 이유는 어드바이저리 락이 세션에 매달리는데 풀러 뒤에서는 세션이 갈려
> 락을 되찾지 못하고 **멈추기** 때문이다 — 실패가 아니라 정지라 빌드가 타임아웃까지 매달린다.

## 2. Vercel 프로젝트

1. GitHub 저장소를 연결한다. Framework Preset은 Next.js로 자동 감지된다.
2. **Build Command는 손대지 않는다** — `vercel.json`이 이미 덮고 있고, 대시보드에서 또 덮으면
   저장소가 아니라 대시보드가 진실이 되어 이 문서가 거짓말이 된다.
3. Node 버전은 **건드릴 필요가 없다**. `package.json`의 `engines.node`(`22.x`)가 대시보드
   설정을 덮는다. (Vercel은 `.node-version` 파일을 읽지 않는다 — 그 파일은 로컬 fnm용이다.)
4. 나머지 환경변수를 등록한다 — 키 목록과 각 값의 출처는 [`.env.example`](../.env.example)에
   있다. **DB 두 키만 빼고** Production · Preview 스코프 양쪽에 필요하다.

## 3. Clerk 웹훅 실연동

1. 배포용 인스턴스의 키를 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` · `CLERK_SECRET_KEY`에 넣는다.
2. 대시보드 > Webhooks > **Add Endpoint**:
   - URL: `https://<배포 도메인>/api/webhooks/clerk` — **프로덕션 도메인**을 쓴다.
     프리뷰 URL은 배포마다 바뀌어 엔드포인트로 등록할 수 없다.
   - 구독 이벤트 **9종** (`src/app/api/webhooks/clerk/route.ts`가 처리하는 전부):
     `user.created` · `user.updated` · `user.deleted` ·
     `organization.created` · `organization.updated` · `organization.deleted` ·
     `organizationMembership.created` · `organizationMembership.updated` · `organizationMembership.deleted`
3. 그 엔드포인트의 **Signing Secret**을 `CLERK_WEBHOOK_SIGNING_SECRET`에 넣는다.
   미설정이면 라우트가 500을 돌려준다 — 400이 아닌 이유는 위조 시도와 설정 누락이
   대시보드에서 구분돼야 하기 때문이다.

## 4. Pusher

`.env.example`의 4개 키를 채운다. 클라이언트에 노출되는 것은 `NEXT_PUBLIC_PUSHER_KEY`와
`NEXT_PUBLIC_PUSHER_CLUSTER` 둘뿐이고, `PUSHER_SECRET`은 절대 `NEXT_PUBLIC_`을 붙이지 않는다.

## 4b. 첨부 스토리지 (KAN-35, Cloudflare R2)

R2 버킷 하나를 만들고 API 토큰을 발급해 `.env.example`의 `S3_*` 5종을 채운다. 로컬 MinIO와
같은 코드가 그대로 돈다(`forcePathStyle` 경로 스타일이라 어느 쪽도 동작).

- `S3_ENDPOINT`는 R2의 S3 API 엔드포인트(`https://<account_id>.r2.cloudflarestorage.com`),
  `S3_REGION`은 `auto`.
- **엔드포인트는 브라우저에서 접근 가능해야 한다** — 업로드(presigned POST)·다운로드
  (presigned GET)가 스토리지에 직접 붙는다. 내부 전용 주소면 서버만 되고 브라우저가 실패한다.
- 버킷은 비공개로 둔다. 모든 접근이 짧은 presigned URL이라 공개 읽기가 필요 없다.
- **CORS를 반드시 연다.** 브라우저가 앱 origin에서 R2로 직접 POST한다 — R2는 기본이 차단이라
  앱 도메인(프로덕션 + 프리뷰)을 허용 목록에 넣지 않으면 업로드만 조용히 실패한다.
  MinIO는 기본 전체 허용이라 로컬에서는 이 단계가 없었다.
- 5종이 없으면 첨부 기능만 조용히 꺼진다 — 배포를 막지 않는다.

## 4c. 스토리지 정리 cron (KAN-70)

`vercel.json`의 `crons`에 **이미 등록돼 있다** — `/api/cron/storage-cleanup`을 매일 18:00 UTC
(03:00 KST)에 부른다. 남은 것은 `CRON_SECRET`을 난수로 채우는 것뿐이다. Vercel은 등록된 cron
호출에 `Authorization: Bearer ${CRON_SECRET}`을 자동으로 싣는다. 시크릿 미설정이면 라우트가
전부 401이다(fail-closed).

- 하루 1회면 충분하다 — 고아 오브젝트는 쌓일 뿐 새지 않는다. Vercel Hobby 플랜의 cron이
  하루 1회 제한인 것과도 맞는다(정확한 분이 아니라 그 시간대 안에서 발화한다).
- 등록 전이나 수동 확인이 필요할 때는 같은 헤더로 curl 해서 돌린다.

## 5. 배포 직후 스모크 (KAN-77)

```bash
curl -s https://<배포 도메인>/api/health
# {"status":"ok","migrations":23,"commit":"7b233a7"}
```

빌드가 초록이어도 런타임 `DATABASE_URL`이 틀리면 첫 사용자 요청에서야 드러난다. 이 한 줄이
**런타임이 DB에 실제로 붙는가**와 **마이그레이션이 다 올라갔는가**를 같이 답한다.

- `migrations`는 `prisma/migrations`의 디렉터리 수와 같아야 한다 (`ls prisma/migrations | wc -l`
  에서 `migration_lock.toml` 1개를 뺀 값).
- `commit`은 지금 떠 있는 배포의 커밋 SHA 앞 7자리다 — "머지한 게 맞나"를 여기서 본다.
- `status:"error"`(503)면 DB에 못 붙은 것이다. 원인은 응답에 싣지 않으므로(공개
  엔드포인트라 연결 문자열이 샌다) Vercel 런타임 로그에서 `[health]`를 찾는다.

## 6. 배포 후 검증 체크리스트

KAN-27이 닫히려면 아래가 실제 배포에서 통과해야 한다.

- [ ] `/api/health`가 200 + 마이그레이션 수가 저장소와 일치 — 빌드 로그에 `migrate deploy` 성공
- [ ] 로그인 → 조직 생성 → 채널 목록까지 진입
- [ ] **웹훅 미러**: 사용자·조직·멤버십을 만들면 DB에 행이 생긴다 (KAN-11)
- [ ] **순서 역전 가드**: 삭제한 뒤 도착하는 지연 이벤트가 행을 되살리지 못한다 —
      tombstone + `clerkUpdatedAt` 이중 가드 (KAN-12). 로컬 재현 레시피는 있었지만
      실제 배달 순서로 확인된 적은 없다
- [ ] **실시간**: 브라우저 둘로 메시지 · 타이핑 · 리액션 · 안읽음 뱃지
- [ ] **공동 편집**: 브라우저 둘로 같은 노트 동시 편집 · 커서 표시 (KAN-39 · KAN-75)
- [ ] **첨부 업로드**: 파일을 올린다 — R2 CORS가 막혀 있으면 여기서만 실패한다
- [ ] 조직 삭제 시 그 조직 데이터가 Cascade로 사라진다 (KAN-19)
- [ ] **스토리지 정리** (KAN-70): 조직 삭제 후 cron 스윕(유예 15분 경과)을 돌리면
      스토리지의 `org/{orgId}/att/` 프리픽스가 빈다
- [ ] **프리뷰 격리**: PR 프리뷰 배포가 뜨고, 그 배포의 마이그레이션이 스테이징 DB에
      들어가지 않는다 (Neon 브랜치가 실제로 갈렸는지 Neon 콘솔에서 확인)

## 정해 둔 판단

- **마이그레이션을 빌드에 붙였다.** 배포 단위가 하나뿐이고 별도 릴리스 훅이 없다. 대가는
  빌드가 성공하고 배포가 실패해도 **스키마만 앞서 나간다**는 것 — 그래서 파괴적 변경은
  expand → contract 2단계로 나눠야 한다(`prisma/migrations/20260803120000_message_commit_order_seq`
  주석에 같은 규칙이 적혀 있다).
- **프리뷰는 켜고 DB를 가른다.** 빌드 커맨드가 하나라 프리뷰도 마이그레이션을 돌린다 —
  DB를 안 가르면 병합되지도 않은 브랜치의 스키마가 스테이징에 먼저 들어간다. 프리뷰를
  끄는 선택지도 있었지만, PR마다 실제로 눌러 볼 URL이 생기는 값이 더 크다고 봤다.
- **직결 키 이름을 Neon 관례(`DATABASE_URL_UNPOOLED`)로 맞췄다.** 우리 식으로 지으면 그
  키만 손으로 박은 고정값이 되어 프리뷰에서 풀러/직결이 서로 다른 DB를 가리킨다.
- **헬스체크에 인증을 걸지 않았다.** 호출 주체가 업타임 모니터·배포 스모크라 시크릿을
  쥐여줄 자리가 없고, 새는 것은 마이그레이션 개수와 커밋 SHA뿐이다. cron 라우트의
  fail-closed와 반대인 이유는, 헬스체크가 401이면 배포 상태를 볼 수단 자체가 사라져서다.
- **`.env.example`을 추적한다.** `.gitignore`의 `.env*`에 예외를 하나 뒀다. 값이 아니라 키
  목록이라 커밋해도 새는 것이 없고, 없으면 배포 때마다 코드에서 `process.env`를 grep하게 된다.
