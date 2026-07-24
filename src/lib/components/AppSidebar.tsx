'use client';

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, LayoutGrid, MessageSquare, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// 슬랙형 좌측 내비 레일. 딥바이올렛 사이드바 토큰을 쓰며, 모바일은 아이콘만(w-16),
// md 이상에서 라벨까지(w-60) 펼친다. 활성 경로는 accent 오버레이로 강조.
const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/chat', label: '채팅', icon: MessageSquare },
  { href: '/notes', label: '노트', icon: FileText },
  { href: '/board', label: '보드', icon: LayoutGrid },
  { href: '/members', label: '멤버', icon: Users },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-16 shrink-0 flex-col gap-1 bg-sidebar p-2 text-sidebar-foreground md:w-60 md:p-3">
      <NextLink
        href="/chat"
        className="mb-2 flex items-center gap-2 rounded-lg px-1.5 py-2 md:px-2"
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
        >
          D
        </span>
        <span className="hidden truncate font-semibold tracking-tight md:inline">DankangNote</span>
      </NextLink>

      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <NextLink
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              title={label}
              className={cn(
                'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors md:px-3',
                active
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="size-5 shrink-0 md:size-4" />
              <span className="hidden md:inline">{label}</span>
            </NextLink>
          );
        })}
      </nav>
    </aside>
  );
}
