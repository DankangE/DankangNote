import type { ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';

// 목록이 비었을 때의 공용 안내. shadcn에 딱 맞는 컴포넌트가 없어 얇게 직접 만든다.
// 아이콘은 화면 성격에 맞게 넘길 수 있고(장식이라 aria-hidden), 기본은 빈 받은함(Inbox).
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-5" />
      </div>
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </div>
  );
}
