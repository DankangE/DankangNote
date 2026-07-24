'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

// 라이트↔다크 토글. 아이콘 전환은 CSS(dark: variant)로 처리해 하이드레이션 불일치가 없다.
// 현재 상태를 보여준다(shadcn 관례): 라이트=해, 다크=달. 버튼 aria-label이 접근명을 제공하므로
// 아이콘은 aria-hidden(장식).
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="테마 전환"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun aria-hidden className="block dark:hidden" />
      <Moon aria-hidden className="hidden dark:block" />
    </Button>
  );
}
