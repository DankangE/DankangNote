'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

// 라이트↔다크 토글. 상태 저장·클래스 적용은 next-themes가 담당한다(ThemeProvider 참조).
// 아이콘은 두 개를 항상 렌더하고 CSS(dark:)로 전환해, 마운트 전후 상태 차이로 생기는
// 하이드레이션 불일치를 원천적으로 피한다.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="테마 전환"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Moon className="dark:hidden" />
      <Sun className="hidden dark:block" />
    </Button>
  );
}
