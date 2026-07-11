# General Rules

모든 코드 작업에 적용되는 공통 규칙.

## 커뮤니케이션

- 답변은 한국어로 한다.
- 각 단계에서 **무엇을 왜 하는지** 짧게 설명한다 (학습 목적 프로젝트).
- 불확실한 최신 API는 추측하지 말고 공식 문서(`node_modules/next/dist/docs/` 등)나 CLI로 확인 후 진행한다.
- 설치 실패·호환성 문제가 생겨도 **임의로 다른 라이브러리로 대체하지 말고 먼저 물어본다**.

## 실행 환경 (WSL)

- 패키지 매니저는 **pnpm** (10.x, `npm i -g pnpm`으로 설치됨. corepack 사용 불가).
- 시스템 node는 v20이지만 프로젝트는 **Node 22** 필요 (`.node-version` = 22.23.1).
- Node 22가 필요한 명령(특히 astryx CLI)은 fnm 스코프로 실행:
  ```bash
  FNM_DIR=$HOME/.local/share/fnm ~/.local/share/fnm/fnm exec --using 22 -- pnpm exec astryx <cmd>
  ```

## 브랜치 / 이슈 관리

- 기능·버그 작업은 Jira 티켓과 연결된 브랜치에서 한다 (`feat/KAN-12-slug` 형식). 새 작업 시작 시 `/ticket` 스킬 사용.
- 현재 브랜치 이름에 Jira 이슈 키가 있으면, 커밋 메시지와 PR 제목에 그 키를 포함한다.

## 코드 스타일

- TypeScript strict. `any` 금지, 타입 단언은 최후 수단.
- 파일·컴포넌트는 작게. 한 파일이 200줄을 넘으면 분리를 고려한다.
- 주석은 코드로 표현 못 하는 제약·이유만 적는다.
