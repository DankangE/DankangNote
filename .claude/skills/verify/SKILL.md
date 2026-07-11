---
name: verify
description: DankangNote 앱을 실제로 띄워 변경사항을 런타임에서 검증하는 레시피 (dev 서버 기동, Server Action HTTP 직접 호출, DB 시딩/정리)
---

# DankangNote 검증 레시피

## 사전 조건

- Postgres: `docker compose up -d` (localhost:5432, .env의 DATABASE_URL 사용).
  Claude 셸은 docker 그룹 미적용 상태일 수 있음 — 포트 체크로 대신 확인:
  `timeout 1 bash -c '</dev/tcp/localhost/5432'`
- Node 22 필요 — 모든 pnpm 명령은 fnm 스코프로:
  ```bash
  FNM_DIR=$HOME/.local/share/fnm ~/.local/share/fnm/fnm exec --using 22 -- pnpm <cmd>
  ```

## dev 서버 기동

```bash
FNM_DIR=$HOME/.local/share/fnm ~/.local/share/fnm/fnm exec --using 22 -- pnpm dev
```

백그라운드로 띄우고 포트 3000 오픈까지 12초쯤 걸림. Turbopack이라 페이지 첫 요청 시 컴파일됨.

## Server Action을 HTTP로 직접 호출

Server Action은 그것을 import하는 페이지가 컴파일돼야 등록된다.
아무 페이지도 import하지 않으면 임시 페이지를 만들어 등록시킬 것 (검증 후 삭제).

1. 해당 페이지를 한 번 GET해서 컴파일 트리거.
2. 액션 ID는 매니페스트에서 확인 (`exportedName` 필드로 함수명 매핑 가능):
   `.next/dev/server/app/<route>/page/server-reference-manifest.json`
3. 호출:
   ```bash
   curl -s http://localhost:3000/<route> \
     -H 'Next-Action: <액션ID>' \
     -H 'Content-Type: text/plain;charset=UTF-8' \
     --data '[<인자1>, <인자2>]'   # JSON 배열 = 함수 인자 목록
   ```
   응답은 RSC flight 스트림 — 반환값은 `grep -o '{"ok":...}'`로 추출.

## DB 직접 시딩/정리 (멀티테넌시 프로브 등)

`pg`는 pnpm 스토어에만 있음:

```bash
PGDIR=$(ls -d node_modules/.pnpm/pg@*/node_modules/pg | head -1)
node -e "const {Client}=require('$PGDIR'); ..."
```

## 꼭 확인할 프로브

- 멀티테넌시: 다른 orgId 행을 직접 INSERT → 목록에 안 보이고, 그 id로 update/delete가 거부되는지.
- zod 검증: 빈/초과/타입 불일치 입력이 `{ok:false, error}`로 돌아오는지.
