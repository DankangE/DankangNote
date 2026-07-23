---
paths:
  - "src/server/**"
  - "src/app/api/**"
  - "src/**/actions.ts"
  - "prisma/**"
---

# Backend Rules

API, Server Action, Prisma, 인증, 멀티테넌시 작업 시 적용.

## 스택 (일부 도입 예정)

- DB: **PostgreSQL + Prisma** (docker-compose로 로컬 DB 예정)
- 인증·멀티테넌시: **Clerk** (Organization = 워크스페이스, 초대·역할 포함)

## 데이터 접근

- Prisma 클라이언트는 `src/server/`에 싱글턴으로 두고, 클라이언트 컴포넌트에서 import되지 않게 `server-only`로 막는다.
- 변이(mutation)는 Server Action 우선, 외부 노출이나 웹훅이 필요한 경우만 Route Handler를 쓴다.
- 모든 외부 입력(폼, 파라미터, 웹훅 페이로드)은 서버에서 zod 등으로 검증한 후 사용한다. 서명 검증되는 웹훅(Clerk/Svix 등)은 서명 검증 + 제공 SDK 타입으로 갈음할 수 있다.

## 멀티테넌시 (가장 중요)

- 모든 테넌트 소속 데이터 쿼리는 **반드시 현재 사용자의 orgId(워크스페이스)로 스코프**한다. `where: { orgId }` 없는 테넌트 데이터 조회는 버그로 간주한다.
- 인증·orgId 확인은 각 Server Action / Route Handler 진입부에서 공용 헬퍼로 수행한다 — 개별 구현 산재 금지.
- 권한(역할) 검사는 서버에서 한다. 클라이언트의 UI 숨김은 편의일 뿐 보안이 아니다.

## 스키마 변경

- Prisma 스키마 변경 시 마이그레이션 파일을 생성하고(`prisma migrate dev`), 스키마와 마이그레이션을 같은 커밋에 포함한다.
