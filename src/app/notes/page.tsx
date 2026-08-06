import { FileText } from 'lucide-react';
import { auth } from '@clerk/nextjs/server';
import { CenteredPage } from '@/lib/components/CenteredPage';
import { EmptyState } from '@/lib/components/EmptyState';
import { NoOrganization } from '@/lib/components/NoOrganization';

// 노트의 착지점(KAN-37) — 채팅과 달리 '기본 문서'라는 개념이 없어 리다이렉트하지 않고,
// 트리에서 고르거나 새로 만들라는 안내만 둔다. 문서 선택·생성은 레이아웃의 사이드바 몫.
export default async function NotesPage() {
  const { orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  return (
    <CenteredPage>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">노트</h1>
        <p className="text-muted-foreground">워크스페이스의 문서</p>
      </div>
      <EmptyState
        icon={FileText}
        title="문서를 선택하세요"
        description="사이드바에서 문서를 고르거나 + 버튼으로 새 문서를 만들어 보세요."
      />
    </CenteredPage>
  );
}
