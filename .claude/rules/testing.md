---
paths:
  - "**/*.test.ts"
  - "test/**"
  - "vitest.config.ts"
---

# Testing Rules

테스트 작성·실행 시 적용 (KAN-25에서 도입).

## 스택과 실행

- **Vitest**. `pnpm test`(1회 실행) / `pnpm test:watch`.
- 테스트 파일은 대상 옆에 둔다 — `src/server/services/notes.test.ts`. 공용 픽스처는 `test/`.
- Postgres가 떠 있어야 한다: `docker compose up -d`.

## 테스트 DB

- `TEST_DATABASE_URL`이 있으면 그것을, 없으면 **`DATABASE_URL`의 DB명 + `_test`**를 쓴다
  (`test/database-url.ts`). 파생 결과가 개발 DB와 같으면 즉시 중단한다 — 테스트는 매번
  전 테이블을 TRUNCATE하기 때문이다.
- 없는 DB는 `prisma migrate deploy`(globalSetup)가 자동으로 만든다. 사전 준비 불필요.
- 각 테스트는 `beforeEach`에서 `resetDatabase()` + 필요한 시드로 시작한다.

## 무엇을 테스트하나

**깨지면 보안 사고인 것을 1순위로 한다.**

1. **멀티테넌시 격리** — 새 테넌트 데이터 서비스를 만들면 "다른 org의 id를 알아도 조회·수정·
   삭제가 안 된다"는 테스트를 반드시 함께 만든다. 이건 선택이 아니다.
2. **권한 규칙** — 작성자/타인/admin 매트릭스.
3. **수명 정책** — 조직 삭제 시 그 조직 데이터가 cascade로 파기되는지.
4. **tombstone 가드** — 삭제된 org·user로의 쓰기가 거부되는지.

## 실제 DB를 쓰는 이유

격리 보장이 Prisma 쿼리의 `where` 절에 살아 있다. Prisma를 목으로 대체하면 목이 정의한
동작을 검증할 뿐, **정작 지켜야 할 SQL 조건은 검증하지 못한다**. 그래서 서비스 계층
테스트는 실제 Postgres를 쓴다.

## 주의

- 전 테스트가 한 DB를 공유하므로 `fileParallelism: false`다. 병렬로 돌리면 서로의 데이터를
  지운다.
- `server-only`는 Next 밖에서 throw하므로 `test/stubs/server-only.ts`로 별칭 대체된다
  (`vitest.config.ts`).
- 테스트를 추가한 뒤에는 **일부러 규칙을 깨뜨려 그 테스트가 실제로 실패하는지** 한 번
  확인한다. 통과만 하는 테스트는 안전망이 아니다.
