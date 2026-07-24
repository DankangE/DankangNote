---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# UI / 스타일링 룰 (shadcn/ui + Tailwind)

UI·스타일링 작업 시 적용. **2026-07-25: Astryx 디자인 시스템 + StyleX에서 shadcn/ui +
Tailwind v4로 전환** (이유는 아래). 전환 중에는 두 스택이 잠시 공존한다.

## 스택

- **UI 컴포넌트: shadcn/ui** (Base UI 기반, `src/components/ui/`에 소스가 복사돼 있음).
  있으면 우선 사용, 없으면 `pnpm dlx shadcn@latest add <comp>`로 추가하거나 Tailwind로 직접 만든다.
- **스타일링: Tailwind CSS v4** 유틸리티 클래스. 테마 색은 `src/app/globals.css`의 CSS
  변수(shadcn 시맨틱 토큰: `bg-background`·`text-foreground`·`bg-primary`·`border-border`·
  `text-muted-foreground` 등)로 쓴다 — 하드코딩 색 지양.
- 클래스 조건부 합성은 `cn()`(`@/lib/utils`, clsx + tailwind-merge).
- 아이콘: **lucide-react**.
- 레이아웃은 Tailwind flex/grid 유틸(`flex flex-col gap-4` 등)로 직접. Astryx `Stack`을
  대체할 별도 컴포넌트는 두지 않는다.

## 왜 StyleX/Astryx가 아닌가 (전환 근거, KAN-20)

- StyleX 직접 작성은 `@stylexjs/babel-plugin`(babel.config.js)이 필수. babel 설정을 두면
  Next가 SWC(Next Compiler)에서 opt-out → **next/font(Geist)가 깨지고** TS/JSX 파싱까지
  무너져 Turbopack 빌드가 실패한다(실측 확정). PostCSS 방식(@stylexjs/postcss-plugin)도
  babel.config.js를 요구해 같은 문제.
- Tailwind는 PostCSS 기반이라 babel 불필요 → next/font·Turbopack과 충돌 없음.

## 규칙

- 임의 인라인 `style` 지양 — Tailwind 클래스로. 단, dnd-kit의 프레임별 `transform`처럼
  동적으로 계산되는 값은 인라인 유지가 불가피하다(허용).
- Button variant: `default`(주 액션)·`secondary`·`outline`·`ghost`·`destructive`·`link`.
  size: `sm`·`default`·`lg`·`icon`. (Astryx의 primary→default 매핑.)
- 다크모드는 `.dark` 클래스 기반(`@custom-variant dark`) — 시맨틱 토큰을 쓰면 자동 대응.

## 셋업 (참고)

- Tailwind v4: `postcss.config.mjs`에 `@tailwindcss/postcss`, `globals.css`에
  `@import "tailwindcss"`. v4는 CSS-first라 `tailwind.config`는 선택.
- shadcn 설정: `components.json`(style `base-nova`, Base UI, CSS 변수). 별칭 `@/components/ui`.
