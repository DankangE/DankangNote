---
paths:
  - "src/**/*.tsx"
  - "src/features/**"
---

# Frontend Rules

페이지, 클라이언트 컴포넌트, 상태 관리, 데이터 페칭 작업 시 적용.

## Next.js (App Router, v16)

- **이 프로젝트의 Next 16은 학습 데이터와 다를 수 있다.** 불확실한 API는 `node_modules/next/dist/docs/`에서 해당 가이드를 먼저 읽는다.
- Server Component가 기본. `'use client'`는 상호작용·브라우저 API가 필요한 최소 단위(leaf)에만 붙인다.
- dev 서버는 Turbopack 기본이다.

## 상태 관리

- **서버 상태**: TanStack Query. 서버에서 온 데이터를 Zustand나 useState에 복사해 두지 않는다.
- **클라이언트 상태**: Zustand. 전역이 정말 필요한 것만 — 컴포넌트 로컬이면 useState.
- URL로 표현 가능한 상태(필터, 탭, 페이지)는 searchParams를 우선한다.

## 도메인별 라이브러리 (도입 예정 포함)

- 문서 편집: **Tiptap** / 실시간 채팅: **Pusher** / 보드 DnD: **dnd-kit**.
- 아직 설치 전인 라이브러리를 쓰는 작업이면 설치부터 진행하되, 버전·설정은 공식 문서로 확인한다.

## UI

- 컴포넌트·스타일 규칙은 `.claude/rules/astryx.md`를 따른다 (아직 안 읽었으면 읽을 것).
