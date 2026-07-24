'use client';

import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

// 라이트/다크 토글. next-themes 같은 의존성 없이 <html>.dark 클래스 + localStorage로만
// 동작한다 — 초기 적용은 layout <head>의 no-flash 스크립트가 담당(하이드레이션 전).
// 아이콘은 두 개를 항상 렌더하고 CSS(dark:)로 전환해 상태 기반 하이드레이션 불일치를 피한다.
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const isDark = root.classList.toggle('dark');
    try {
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    } catch {
      // localStorage 접근 불가(프라이빗 모드 등)면 이 세션 한정으로만 적용된다.
    }
  }

  return (
    <Button variant="ghost" size="icon" aria-label="테마 전환" onClick={toggle}>
      <Moon className="dark:hidden" />
      <Sun className="hidden dark:block" />
    </Button>
  );
}
