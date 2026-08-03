import type { ClerkProvider } from '@clerk/nextjs';
import type { ComponentProps } from 'react';

/**
 * Clerk가 렌더하는 UI(로그인·조직 전환기·유저 메뉴)를 우리 디자인 토큰에 붙인다 (KAN-24).
 *
 * Clerk 기본 테마는 라이트 고정이라, 앱이 `.dark`로 넘어가도 상단바의 OrganizationSwitcher·
 * UserButton 두 개만 밝게 남았다. 슬랙형 셸에서 그 둘은 상시 노출이라 눈에 그대로 띈다.
 *
 * **값을 복사하지 않고 `var(--token)`을 그대로 넘긴다.** 두 가지가 한꺼번에 해결된다.
 * ① 다크 모드 배선이 아예 필요 없다 — CSS 변수는 `.dark`가 걸린 조상에서 재정의되므로,
 *    Clerk 위젯이 그 안에 렌더되는 한 값이 저절로 바뀐다. `useTheme()`을 읽는 클라이언트
 *    경계를 만들어 ClerkProvider를 감쌀 필요가 없다(서버 프로바이더 동작도 그대로 둔다).
 * ② 브랜드 색이 한 곳(globals.css)에만 남는다. 여기 값을 적으면 테마를 손볼 때마다
 *    두 곳이 갈라지고, 그 차이는 다크 모드에서만 드러나 늦게 발견된다.
 *
 * `@clerk/ui/themes`의 `dark`를 쓰는 길도 있었지만 택하지 않았다 — 의존성이 하나 늘고,
 * 얻는 것은 '일반적인 다크'라 바이올렛 브랜드와 따로 논다. 라이트 모드도 여전히 Clerk
 * 기본색으로 남는다.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: 'var(--primary)',
    colorPrimaryForeground: 'var(--primary-foreground)',
    colorForeground: 'var(--foreground)',
    // 카드·팝오버 위에 뜨는 위젯이라 --background가 아니라 --popover가 맞다. 다크에서
    // 둘이 다른 값이고(배경 0.17 / 팝오버 0.21), 유저 메뉴는 떠 있는 면이다.
    colorBackground: 'var(--popover)',
    colorMuted: 'var(--muted)',
    colorMutedForeground: 'var(--muted-foreground)',
    colorBorder: 'var(--border)',
    // colorInput은 입력란의 **채움**이다 — 우리 --input은 **테두리** 토큰이라(Input 컴포넌트가
    // `border-input bg-transparent`로 쓴다) 그대로 넘기면 어긋난다. 실제로 라이트에서는 흰
    // 카드 위에 회색 필드가, 다크에서는 15% 흰색이 얹혀 필드만 허옇게 떴다(실측).
    // 테두리는 아래 colorBorder가 이미 맡고 있으므로 채움은 배경색을 준다.
    colorInput: 'var(--background)',
    colorInputForeground: 'var(--foreground)',
    colorRing: 'var(--ring)',
    colorDanger: 'var(--destructive)',
    colorSuccess: 'var(--success)',
    colorWarning: 'var(--warning)',
    borderRadius: 'var(--radius)',
    fontFamily: 'var(--font-sans)',
  },
} satisfies ComponentProps<typeof ClerkProvider>['appearance'];
