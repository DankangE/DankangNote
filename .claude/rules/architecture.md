---
paths:
  - "src/**"
---

# Architecture Rules

새 파일/폴더 생성, 모듈 배치 결정 시 적용.

## 목표 폴더 구조

```
src/
  app/              # 라우팅 전용. 페이지는 얇게 — 로직은 features/로
  features/         # 도메인별 수직 슬라이스 (예: notes/, chat/, board/, workspace/)
    <feature>/
      components/   # 해당 도메인 전용 UI
      hooks/
      api/          # 해당 도메인의 서버 통신 (query/mutation, server action 호출부)
      types.ts
  server/           # 서버 전용 코드 (Prisma 클라이언트, 서비스 로직, 인증 헬퍼)
  lib/              # 도메인 무관 공용 유틸, 공용 훅, 상수
```

## 배치 원칙

- 특정 도메인에만 쓰이면 `features/<도메인>/`, 두 개 이상 도메인에서 쓰이면 `lib/`.
- `server/`의 코드는 클라이언트 컴포넌트에서 import 금지 (`server-only` 패키지로 강제).
- feature 간 직접 import는 지양한다. 공유가 필요해지면 `lib/`로 승격하거나 명시적 public API(`features/<x>/index.ts`)를 통한다.
- `app/`의 page/layout은 조합만 담당 — 데이터 페칭·비즈니스 로직을 페이지 파일에 쌓지 않는다.

## 아직 없는 것

- features/, server/, lib/ 는 아직 생성 전이다. 첫 도입 시 위 구조대로 만들되, 실제 필요한 폴더만 만든다 (빈 폴더 미리 깔지 않기).
