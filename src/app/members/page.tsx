import { auth } from '@clerk/nextjs/server';
import { fetchMembers } from '@/features/workspace/api/queries';
import { MembersView } from '@/features/workspace/components/MembersView';
import { NoOrganization } from '@/lib/components/NoOrganization';

export default async function MembersPage() {
  // auth.protect()는 미인증이면 sign-in으로 redirect하고, 인증되면 auth 객체를 반환한다.
  const { orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  const members = await fetchMembers();
  return <MembersView members={members} />;
}
