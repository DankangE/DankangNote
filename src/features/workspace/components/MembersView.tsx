import { Fragment } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import type { BadgeVariant } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import type { WorkspaceMember } from '@/features/workspace/types';
import { CenteredPage } from '@/lib/components/CenteredPage';

// Clerk 역할 문자열 → 표시 라벨. 알 수 없는 역할은 접두사만 떼고 그대로 보여준다.
function roleBadge(role: string): { label: string; variant: BadgeVariant } {
  if (role === 'org:admin') return { label: '관리자', variant: 'info' };
  if (role === 'org:member') return { label: '멤버', variant: 'neutral' };
  return { label: role.replace(/^org:/, ''), variant: 'neutral' };
}

// 이름이 비어 있으면 이메일, 그것도 없으면 Clerk id로라도 식별한다.
function displayName(member: WorkspaceMember): string {
  const name = [member.user.firstName, member.user.lastName].filter(Boolean).join(' ');
  return name || member.user.email || member.user.id;
}

// 멤버 화면 조합. 상호작용이 없어 서버 컴포넌트로 충분하다.
export function MembersView({ members }: { members: WorkspaceMember[] }) {
  return (
    <CenteredPage>
      <Stack direction="vertical" gap={1}>
        <Heading level={1}>멤버</Heading>
        <Text color="secondary">이 워크스페이스에 속한 멤버 {members.length}명</Text>
      </Stack>

      {members.length === 0 ? (
        <EmptyState
          title="아직 동기화된 멤버가 없어요"
          description="멤버 정보는 Clerk webhook으로 동기화됩니다. webhook 엔드포인트가 연결되면 자동으로 채워져요."
        />
      ) : (
        <Card>
          <Stack direction="vertical" gap={3}>
            {members.map((member, index) => {
              const role = roleBadge(member.role);
              return (
                <Fragment key={member.id}>
                  {index > 0 && <Divider />}
                  <Stack direction="horizontal" gap={3} vAlign="center" justify="between">
                    <Stack direction="horizontal" gap={3} vAlign="center">
                      <Avatar
                        src={member.user.imageUrl ?? undefined}
                        name={displayName(member)}
                        size="medium"
                      />
                      <Stack direction="vertical" gap={1}>
                        <Text weight="semibold">{displayName(member)}</Text>
                        {member.user.email && <Text color="secondary">{member.user.email}</Text>}
                      </Stack>
                    </Stack>
                    <Badge variant={role.variant} label={role.label} />
                  </Stack>
                </Fragment>
              );
            })}
          </Stack>
        </Card>
      )}
    </CenteredPage>
  );
}
