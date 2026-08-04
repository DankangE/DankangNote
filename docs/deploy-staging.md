# 스테이징 배포 절차 (KAN-27)

계정(Vercel · 관리형 Postgres)이 붙는 순간 **값만 채우면 배포되도록** 미리 확정해 둔
문서다(KAN-59). 아직 배포된 환경은 없다 — 여기 적힌 것 중 실제 배포에서 확인된 것은
아직 없고, 확인되면 이 문서를 고친다.

배포가 필요한 이유는 하나다. **Clerk 웹훅은 localhost로 직접 받을 수 없어** 미러 동기화
(KAN-11)와 순서 역전 가드(KAN-12)가 실환경에서 한 번도 안 돌았다.

## 0. 필요한 계정

| 대상 | 왜 |
| --- | --- |
| Vercel | 앱 호스팅. GitHub 저장소 연결 권한 필요 |
| 관리형 Postgres (Neon · Supabase · Vercel Postgres 중 하나) | 서버리스에서 붙을 DB |
| Clerk | 이미 쓰고 있다. **배포용 인스턴스 키**가 따로 필요하다 |
| Pusher | 이미 쓰고 있다. 같은 앱을 재사용해도 된다(cluster 확인) |

## 1. 데이터베이스

1. staging 용도의 DB를 하나 만든다.
2. 연결 문자열을 `DATABASE_URL`로 쓴다. **풀러가 있는 쪽**을 쓴다 — 서버리스는 요청마다
   커넥션을 열어 직결 문자열이면 금방 상한에 닿는다(`src/server/db.ts`가 `@prisma/adapter-pg`로
   커넥션을 만든다).
3. 스키마는 첫 배포 빌드가 적용한다 — `vercel.json`의 빌드 커맨드가
   `pnpm prisma migrate deploy`를 `next build` 앞에 세운다. 현재 마이그레이션은 14개다.

> **마이그레이션이 락에서 멈추면** 풀러 경유가 원인일 수 있다(어드바이저리 락이 풀러
> 뒤에서 세션을 넘나든다). 그때는 마이그레이션만 직결(direct) 문자열로 돌리게 갈라야 한다 —
> `prisma.config.ts`의 `datasource.url`이 지금은 `DATABASE_URL` 하나만 읽으므로, 그 시점에
> 별도 키를 하나 추가한다. 지금 미리 만들지 않은 것은 필요 없을 수도 있는 분기를 먼저
> 들이지 않기 위해서다.

## 2. Vercel 프로젝트

1. GitHub 저장소를 연결한다. Framework Preset은 Next.js로 자동 감지된다.
2. **Build Command는 손대지 않는다** — `vercel.json`이 이미 덮고 있고, 대시보드에서 또 덮으면
   저장소가 아니라 대시보드가 진실이 되어 이 문서가 거짓말이 된다.
3. Node 버전을 **22**로 맞춘다(`.node-version` = 22.23.1).
4. 환경변수를 등록한다 — 키 목록과 각 값의 출처는 [`.env.example`](../.env.example)에 있다.
   Production · Preview 스코프 양쪽에 필요하다.

> **프리뷰 배포가 스테이징 DB에 마이그레이션을 적용한다.** 같은 빌드 커맨드를 쓰기 때문이다.
> PR 프리뷰를 켤 거라면 (a) 프리뷰용 DB를 따로 주거나 (b) 프리뷰 배포를 끄거나 (c) 그대로
> 두고 "프리뷰 브랜치의 마이그레이션이 스테이징에 먼저 들어간다"를 받아들이거나 —
> 셋 중 하나를 계정 연결 시점에 정한다. 지금 정하지 않는 이유는 프리뷰를 쓸지 자체가
> 아직 안 정해져서다.

## 3. Clerk 웹훅 실연동

1. 배포용 인스턴스의 키를 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` · `CLERK_SECRET_KEY`에 넣는다.
2. 대시보드 > Webhooks > **Add Endpoint**:
   - URL: `https://<배포 도메인>/api/webhooks/clerk`
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

## 5. 배포 후 검증 체크리스트

KAN-27이 닫히려면 아래가 실제 배포에서 통과해야 한다.

- [ ] `_prisma_migrations`에 14행 — 빌드 로그에 `migrate deploy` 성공
- [ ] 로그인 → 조직 생성 → 채널 목록까지 진입
- [ ] **웹훅 미러**: 사용자·조직·멤버십을 만들면 DB에 행이 생긴다 (KAN-11)
- [ ] **순서 역전 가드**: 삭제한 뒤 도착하는 지연 이벤트가 행을 되살리지 못한다 —
      tombstone + `clerkUpdatedAt` 이중 가드 (KAN-12). 로컬 재현 레시피는 있었지만
      실제 배달 순서로 확인된 적은 없다
- [ ] **실시간**: 브라우저 둘로 메시지 · 타이핑 · 리액션 · 안읽음 뱃지
- [ ] 조직 삭제 시 그 조직 데이터가 Cascade로 사라진다 (KAN-19)

## 정해 둔 판단

- **마이그레이션을 빌드에 붙였다.** 배포 단위가 하나뿐이고 별도 릴리스 훅이 없다. 대가는
  빌드가 성공하고 배포가 실패해도 **스키마만 앞서 나간다**는 것 — 그래서 파괴적 변경은
  expand → contract 2단계로 나눠야 한다(`prisma/migrations/20260803120000_message_commit_order_seq`
  주석에 같은 규칙이 적혀 있다).
- **`.env.example`을 추적한다.** `.gitignore`의 `.env*`에 예외를 하나 뒀다. 값이 아니라 키
  목록이라 커밋해도 새는 것이 없고, 없으면 배포 때마다 코드에서 `process.env`를 grep하게 된다.
