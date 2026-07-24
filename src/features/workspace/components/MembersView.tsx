import { Fragment } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { WorkspaceMember } from '@/features/workspace/types';
import { CenteredPage } from '@/lib/components/CenteredPage';
import { EmptyState } from '@/lib/components/EmptyState';

// Clerk 역할 문자열 → 표시 라벨. 알 수 없는 역할은 접두사만 떼고 그대로 보여준다.
function roleBadge(role: string): { label: string; variant: 'default' | 'secondary' } {
  if (role === 'org:admin') return { label: '관리자', variant: 'default' };
  if (role === 'org:member') return { label: '멤버', variant: 'secondary' };
  return { label: role.replace(/^org:/, ''), variant: 'secondary' };
}

// 이름이 비어 있으면 이메일, 그것도 없으면 Clerk id로라도 식별한다.
function displayName(member: WorkspaceMember): string {
  const name = [member.user.firstName, member.user.lastName].filter(Boolean).join(' ');
  return name || member.user.email || member.user.id;
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

// 멤버 화면 조합. 상호작용이 없어 서버 컴포넌트로 충분하다.
export function MembersView({ members }: { members: WorkspaceMember[] }) {
  return (
    <CenteredPage>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">멤버</h1>
        <p className="text-muted-foreground">이 워크스페이스에 속한 멤버 {members.length}명</p>
      </div>

      {members.length === 0 ? (
        <EmptyState
          title="아직 동기화된 멤버가 없어요"
          description="멤버 정보는 Clerk webhook으로 동기화됩니다. webhook 엔드포인트가 연결되면 자동으로 채워져요."
        />
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          {members.map((member, index) => {
            const role = roleBadge(member.role);
            const name = displayName(member);
            // 이름이 없어 이메일이 이름 자리에 쓰였으면 보조 줄에 중복 표시하지 않는다.
            const email = member.user.email !== name ? member.user.email : null;
            return (
              <Fragment key={member.id}>
                {index > 0 && <Separator />}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={member.user.imageUrl ?? undefined} alt={name} />
                      <AvatarFallback>{initial(name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="font-semibold">{name}</span>
                      {email && <span className="text-sm text-muted-foreground">{email}</span>}
                    </div>
                  </div>
                  <Badge variant={role.variant}>{role.label}</Badge>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </CenteredPage>
  );
}
