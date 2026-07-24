import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// 페이지 콘텐츠를 중앙 정렬하는 공용 컨테이너 — mx-auto 센터링을 한 곳에 모은다.
// 폭·간격은 className으로 재정의(cn의 tailwind-merge가 충돌 유틸을 정리).
export function CenteredPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mx-auto flex w-full max-w-3xl flex-col gap-6 p-6', className)}>
      {children}
    </div>
  );
}
