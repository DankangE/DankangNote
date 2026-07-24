import NextLink from 'next/link';
import type { ReactNode } from 'react';

// 헤더 네비 링크 — next/link + Tailwind. 시맨틱 토큰으로 hover 대비를 준다.
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <NextLink
      href={href}
      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </NextLink>
  );
}
