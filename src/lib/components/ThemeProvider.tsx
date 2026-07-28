'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

// next-themes 래퍼 — 서버 컴포넌트인 layout이 클라이언트 프로바이더를 쓸 수 있게 경계를 만든다.
// 직접 만든 no-flash 스크립트를 대체한다(KAN-23): 라이브러리가 FOUC 방지 스크립트 주입,
// OS 테마 변경 실시간 반영, 탭 간 동기화, color-scheme 지정까지 함께 처리한다.
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
