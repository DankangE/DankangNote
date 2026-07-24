'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

// next-themes 래퍼 — layout(서버 컴포넌트)이 클라이언트 프로바이더를 쓸 수 있게 경계를 만든다.
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
