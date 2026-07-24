'use client';

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// 헤더 네비 링크. 활성 경로는 브랜드(primary)로 강조하고 aria-current로 스크린리더에도 알린다.
// 현재 경로 접두사 매칭이라 /notes/123 같은 하위 경로도 활성으로 잡는다.
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <NextLink
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'text-sm transition-colors',
        active
          ? 'font-medium text-primary'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </NextLink>
  );
}
