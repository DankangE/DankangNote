# DankangNote 디자인 시스템

협업 워크스페이스(노션·슬랙·지라를 잇는) DankangNote의 디자인 언어 레퍼런스.
"무엇을 왜 그렇게 쓰는가"를 정의한다. 실제 토큰 값은 [`src/app/globals.css`](src/app/globals.css)에,
코드 작성 규칙은 [`.claude/rules/ui-styling.md`](.claude/rules/ui-styling.md)에 있다.

- **스택**: Tailwind CSS v4 (CSS-first) + shadcn/ui (Base UI) + lucide-react. (KAN-20에서 Astryx/StyleX에서 전환.)
- **원천(single source of truth)**: `globals.css`의 CSS 변수. 컴포넌트는 원시 색(oklch)이 아니라 **시맨틱 토큰 이름**으로만 쓴다.

---

## 1. 원칙

1. **토큰이 원천이다.** 색·반경·폰트는 하드코딩하지 않는다. `bg-primary`·`text-muted-foreground`처럼 시맨틱 유틸로만 쓰고, 값 변경은 `globals.css` 한 곳에서 한다. 이러면 다크모드·리브랜딩이 자동 전파된다.
2. **절제된 브랜드.** 표면(배경·카드)은 거의 무채색으로 조용히 두고, **바이올렛은 의미가 있는 곳**(주 액션·링크·활성·포커스)에만 쓴다. 색이 곧 "여기가 상호작용 지점"이라는 신호가 되게 한다.
3. **위계는 명도·간격·엘리베이션으로.** 색을 더 칠하기보다 대비와 여백으로 우선순위를 만든다.
4. **접근성은 기본값.** 본문 텍스트 대비 AA(≥4.5), 포커스는 항상 보이게(브랜드 링), 상태는 색만이 아니라 텍스트/아이콘으로도 전달.
5. **라이트·다크 동등.** 모든 토큰은 두 테마에서 정의되고 두 테마에서 검증된다. 어느 쪽도 후순위가 아니다.

---

## 2. 브랜드

- **주색: 바이올렛** (oklch hue **296**). 모던·창의·개성 — 노션/리니어 계열의 감각.
- **성격**: 차분한 무채색 표면 위에 선명한 바이올렛 포인트. 화려함보다 "집중을 방해하지 않는 도구".
- **브랜드 마크**: 바이올렛 라운드 스퀘어에 모노그램 `D` + 워드마크 `DankangNote`. 헤더 좌상단, `/notes`로 링크.

```
[D] DankangNote      노트  채팅  보드  멤버              ☾  org  user
 └ bg-primary          └ 활성 탭은 text-primary(바이올렛)
```

---

## 3. 색 (Color)

### 시맨틱 토큰

모든 색은 아래 역할 이름으로 쓴다. `-foreground`는 그 표면 위 텍스트/아이콘 색이다.

| 토큰 | 용도 | Light | Dark |
| --- | --- | --- | --- |
| `background` / `foreground` | 페이지 바탕 / 본문 | `oklch(1 0 0)` / `0.21 0.02 296` | `0.17 0.01 296` / `0.97 0.005 296` |
| `card` / `card-foreground` | 카드·패널 표면 | 흰색 / 본문색 | `0.21 0.012 296` / 밝은 글씨 |
| `popover` / `-foreground` | 오버레이(드롭다운·팝오버) | 카드와 동일 | 카드와 동일 |
| `primary` / `-foreground` | **주 액션·링크·활성** | `0.55 0.22 296` / 흰색 | `0.64 0.19 296` / 어두운 글씨 |
| `secondary` / `-foreground` | 보조 버튼·낮은 강조 | 옅은 뉴트럴 / 본문 | 어두운 뉴트럴 / 밝음 |
| `muted` / `-foreground` | 약한 배경 / 보조 텍스트 | `0.968…` / `0.52 0.02 296` | `0.27…` / `0.71 0.015 296` |
| `accent` / `-foreground` | hover 표면(메뉴 항목 등) | 옅은 바이올렛 틴트 | 어두운 틴트 |
| `border` / `input` | 경계선 / 입력 테두리 | `0.922 0.006 296` | 흰색 10–15% |
| `ring` | 포커스 링 = **브랜드** | 바이올렛 | 바이올렛 |
| `destructive` / `-foreground` | 파괴적 액션·오류 | 레드 | 레드 |
| `success` `warning` `info` (+ `-foreground`) | 상태(성공·주의·정보) | green·amber·blue | 밝은 변형 |
| `chart-1…5` | 카테고리형 데이터 시각화 | 바이올렛·teal·amber·rose·blue | 밝은 변형 |

> 다크 `primary`는 밝은 바이올렛이라 **버튼 글씨를 어둡게**(vibrant 버튼) 둬 대비를 확보한다. 라이트는 흰 글씨. 이 비대칭은 의도된 것.

### primary는 언제 쓰나

- **쓴다**: 화면당 하나의 주 액션(생성·저장·확인), 텍스트 링크, 활성 내비/탭, 포커스 링, 선택 상태.
- **안 쓴다**: 표면 배경 대량 채색, 취소/보조 액션, 단순 정보 텍스트. → 무채색·`secondary`·`ghost`로.

### 상태 색은 tinted 패턴으로

`success/warning/info`는 **틴트 배경 + 색 텍스트**로 쓴다(라이트·다크 모두 AA 통과). `destructive`와 동일한 패턴:

```tsx
<span className="rounded-md bg-success/10 px-2 py-0.5 text-sm text-success">저장됨</span>
<p className="text-sm text-destructive">{error}</p>
```

솔리드 필(`bg-success` + 흰 글씨)은 **라이트 전용**으로만 대비가 맞는다 — 다크에서 솔리드가 필요하면 `-foreground` 토큰(어두운 글씨)을 쓸 것.

### 접근성(대비)

주요 쌍을 oklch→sRGB로 변환해 WCAG 대비를 계산·검증했다(라이트/다크 모두 **본문 ≥ 4.5 : 1**):

| 쌍 | Light | Dark |
| --- | --- | --- |
| foreground / background | 17.8 | 17.5 |
| muted-foreground / background | 5.5 | 7.4 |
| primary-foreground / primary (버튼) | 5.2 | 5.4 |
| primary / background (링크) | 5.4 | 5.3 |
| destructive·success·info / background (텍스트) | 4.8·5.2·5.5 | 6.6·8.2·7.8 |

모든 브랜드/상태 색은 sRGB gamut 안에 있다(clamp로 인한 색 변형 없음).

---

## 4. 타이포그래피

- **본문/제목: Geist Sans** (`--font-sans`, next/font). **코드: Geist Mono** (`--font-mono`).
- 라틴+한글 혼용. 굵기는 `normal`(400)·`medium`(500)·`semibold`(600) 위주, `bold`(700)는 브랜드 마크 등 최소.

| 역할 | 클래스 | 용도 |
| --- | --- | --- |
| Display | `text-3xl/4xl font-semibold tracking-tight` | 랜딩·대형 히어로 |
| Page title (h1) | `text-2xl font-semibold tracking-tight` | 페이지 제목("노트") |
| Section (h2) | `text-xl font-semibold` | 섹션 헤딩 |
| Card title (h3) | `text-lg font-semibold` | 카드·항목 제목 |
| Body | `text-sm` (기본) ~ `text-base` | 본문 |
| Secondary | `text-sm text-muted-foreground` | 메타·설명 |
| Caption | `text-xs text-muted-foreground` | 라벨·타임스탬프 |

- 긴 제목이 큰 글씨일수록 `tracking-tight`로 자간을 좁혀 밀도를 준다.
- 리치 텍스트(Tiptap 노트 본문)는 `prose prose-sm dark:prose-invert max-w-none`로 서식을 복원한다.

---

## 5. 간격 & 레이아웃

- **4px 베이스** (Tailwind 기본 스케일). 컴포넌트 내부 간격은 `gap-1.5`(6px)·`gap-2`(8px)·`gap-3`(12px), 섹션 간은 `gap-6`(24px).
- **콘텐츠 컨테이너**: `CenteredPage` = `mx-auto w-full max-w-3xl flex-col gap-6 p-6`. 읽기 폭을 3xl(48rem)로 제한.
- **페이지 헤더 패턴**: 제목(h1) + 한 줄 설명(`text-muted-foreground`)을 `flex-col gap-1`로.
- **앱 셸 헤더**: `sticky top-0 z-40` + `bg-background/80 backdrop-blur` (스크롤 시 반투명 유리). 하단 `border-b`.

---

## 6. 반경 (Radius)

기준 `--radius: 0.625rem`(10px)에서 파생. 작을수록 조밀, 클수록 부드럽다.

| 토큰 | 값(≈) | 용도 |
| --- | --- | --- |
| `rounded-md` | 8px | 버튼·입력·작은 요소 |
| `rounded-lg` | 10px | 기본 |
| `rounded-xl` | 14px | 카드·패널 |
| `rounded-full` | — | 아바타·pill 배지·상태 도트 |

---

## 7. 엘리베이션 (Elevation)

base-nova는 **경계선 우선**의 평평한 미학이다. 그림자는 위계를 만들 때만 절제해서 쓴다.

| 레벨 | 레시피 | 예 |
| --- | --- | --- |
| 0 · 평면 | `border` | 목록 카드(NoteCard) |
| 1 · 융기 | `border shadow-xs` | 생성 컴포저(주 입력 표면) — 목록보다 한 단 올려 액션 지점을 구분 |
| 2 · 오버레이 | `shadow-md` + `bg-popover` | 드롭다운·팝오버 |

> 다크에서 검정 그림자는 거의 보이지 않는다 → 다크의 위계는 `border`와 표면 명도차로 준다(토큰이 이미 처리).

---

## 8. 모션

- **전환**: 색/상태 변화는 `transition-colors`, 복합은 `transition-all`. 지속은 기본(150ms)~`duration-200`.
- **브랜드 이징**: `--ease-emphasized` = `cubic-bezier(0.16,1,0.3,1)` → `ease-emphasized`. 등장·강조 애니메이션에.
- **감속 우선**: 사라짐보다 등장을 조금 더 길게. 과한 바운스·긴 애니메이션 지양(생산성 도구).
- dnd-kit의 프레임별 `transform`처럼 **동적 계산 값**만 인라인 style 허용.
- `prefers-reduced-motion` 사용자에겐 애니메이션을 최소화한다(Tailwind `motion-reduce:` 변형 사용).

---

## 9. 아이콘

- **lucide-react** 단일 세트. 기본 크기는 버튼 컨텍스트에서 `size-4`(16px), 단독은 `size-5`.
- 의미 없는 장식 아이콘은 `aria-hidden`, 아이콘만 있는 버튼은 `aria-label` 필수.

---

## 10. 컴포넌트 규약

### 버튼 (`@/components/ui/button`)

| variant | 용도 |
| --- | --- |
| `default` | **주 액션**(바이올렛). 화면당 하나 권장 |
| `secondary` | 보조 액션(편집 등) |
| `outline` | 중립적 대안 |
| `ghost` | 최소 강조(취소·아이콘 버튼·툴바) |
| `destructive` | 삭제·되돌릴 수 없는 액션 |
| `link` | 인라인 텍스트 액션 |

size: `sm`·`default`·`lg`·`icon`(정사각). 파괴적 흐름은 **확인 단계**를 둔다(예: "삭제" → "삭제 확정").

### 입력·폼

- `Label` + `Input`/`Textarea`를 `flex-col gap-1.5`로 묶는다. `htmlFor`/`id` 연결 필수.
- 검증 오류는 폼 하단에 `FormError`(`text-sm text-destructive`) 한 줄로. 필드별 나열 대신 첫 메시지.

### 카드·표면

- 표준 레시피: `rounded-xl border bg-card p-4`. 융기 표면은 `shadow-xs` 추가(§7).
- 복잡한 카드는 shadcn `Card`(`CardHeader/Title/Content/Footer`)를 쓴다.

### 빈 상태 (`EmptyState`)

- `rounded-xl border border-dashed p-8 text-center`. 제목 + 설명 + (선택) 액션. 점선 테두리로 "여기에 채워질 자리"를 암시.

### 내비게이션 (`NavLink`)

- 비활성 `text-muted-foreground hover:text-foreground`, **활성 `font-medium text-primary`** + `aria-current="page"`. 하위 경로도 활성으로 매칭.

### 배지·상태 표시

- pill: `rounded-full px-2 py-0.5 text-xs`. 색은 상태 토큰의 tinted 패턴(§3).

---

## 11. 상호작용 상태

| 상태 | 처리 |
| --- | --- |
| hover | 표면 한 단 밝게/어둡게(`hover:bg-muted` 등), 링크는 색/underline |
| active | 버튼은 `translate-y-px`(살짝 눌림) |
| **focus-visible** | **브랜드 링** `ring-3 ring-ring/50 border-ring` — 키보드 사용자에게 항상 보이게 |
| disabled | `opacity-50` + `pointer-events-none` |
| selected/active nav | `text-primary` |

포커스 링은 절대 제거하지 않는다(`outline-none`은 shadcn이 링으로 대체할 때만).

---

## 12. 다크 모드

- `.dark` 클래스를 `<html>`에 토글하는 방식(`@custom-variant dark`). 시맨틱 토큰을 쓰면 컴포넌트 수정 없이 자동 대응.
- **무의존 구현**: `layout.tsx` `<head>`의 no-flash 인라인 스크립트가 하이드레이션 전에 저장된 테마(또는 OS 설정)를 적용해 깜빡임(FOUC)을 막는다. `ThemeToggle`이 클래스·`localStorage['theme']`를 갱신한다(next-themes 등 의존성 없음).
- 새 컴포넌트를 만들 때 **다크용 색을 따로 칠하지 말 것** — 토큰만 쓰면 이미 두 테마가 정의돼 있다.

---

## 13. 접근성 체크리스트

- [ ] 본문 텍스트 대비 ≥ 4.5:1, 큰 텍스트·UI 요소 ≥ 3:1.
- [ ] 색만으로 의미를 전달하지 않는다(상태는 텍스트/아이콘 병기).
- [ ] 모든 인터랙티브 요소에 보이는 포커스 링.
- [ ] 아이콘 전용 버튼에 `aria-label`, 활성 내비에 `aria-current`.
- [ ] `prefers-reduced-motion` 존중.

---

## 14. 적용 규칙 (do / don't)

**Do**
- 시맨틱 토큰 유틸(`bg-card`·`text-muted-foreground`·`border-border`·`text-primary`)로 쓴다.
- 클래스 합성은 `cn()`(`@/lib/utils`).
- 아이콘은 lucide, 레이아웃은 flex/grid 유틸.

**Don't**
- 하드코딩 색(`#…`, 원시 `oklch(...)`)·인라인 `style` 색상.
- primary를 표면 대량 채색이나 보조 액션에 남용.
- 다크 전용 색을 컴포넌트에서 별도 지정(토큰이 처리).

---

### 참조
- 토큰 정의: [`src/app/globals.css`](src/app/globals.css)
- 코드 규칙: [`.claude/rules/ui-styling.md`](.claude/rules/ui-styling.md)
- 관련 티켓: KAN-20(스택 전환), KAN-21(디자인 시스템 정립)
