'use client';

import NextLink from 'next/link';
import { Link } from '@astryxdesign/core/Link';
import type { ReactNode } from 'react';

// Astryx Link + next/link 조합의 클라이언트 래퍼. 서버 컴포넌트(layout)가
// `as={NextLink}`처럼 함수를 클라이언트 컴포넌트 prop으로 직접 넘기면 RSC 직렬화가
// 거부한다("Functions cannot be passed to Client Components") — 조합을 클라이언트
// 경계 안으로 옮겨 직렬화 가능한 prop(href, children)만 경계를 넘게 한다.
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link as={NextLink} href={href} color="secondary" isStandalone>
      {children}
    </Link>
  );
}
