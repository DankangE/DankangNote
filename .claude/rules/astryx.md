---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# Astryx / StyleX Rules

UI·스타일링 작업 시 적용.

## 절대 규칙

- 스타일링은 **StyleX 단독**. Tailwind, shadcn/ui, CSS Modules, styled-components **금지**.
- UI 컴포넌트는 **Astryx 디자인 시스템**(`@astryxdesign/core`)을 우선 사용한다. Astryx에 없는 것만 직접 만든다.

## 테마

- theme-neutral의 CSS는 `@scope([data-astryx-theme="neutral"])`로 스코프되어 있다.
  → 조상 요소(현재 `<html>`)에 `data-astryx-theme="neutral"` 속성이 반드시 있어야 렌더된다.
- Astryx CSS는 precompiled(`@astryxdesign/core/dist/astryx.css`) → 라이브러리 컴포넌트 사용에는 CSS import만으로 충분하다.
- **직접 StyleX(`stylex.create`)를 작성할 때는** 별도 StyleX 빌드 플러그인 설정이 필요하다 (Next 16 dev는 Turbopack 기본). 설정 없이 작성하면 스타일이 적용되지 않으니, 처음 도입 시 빌드 설정부터 확인한다.

## Astryx CLI

- 실행법 (Node 22 필요):
  ```bash
  FNM_DIR=$HOME/.local/share/fnm ~/.local/share/fnm/fnm exec --using 22 -- pnpm exec astryx <cmd>
  ```
- 유용한 명령: `component` (컴포넌트 목록/문서), `doctor` (설정 진단).
- 컴포넌트 API가 불확실하면 추측하지 말고 `astryx component <name>`으로 문서를 확인한다.

## 버전 주의

- StyleX 0.19.0 설치됨 (astryx peer는 ^0.18.3). pnpm 경고가 뜨지만 doctor 통과·렌더 정상 → 다운그레이드하지 않는다.
