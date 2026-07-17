import { auth } from '@clerk/nextjs/server';
import { fetchNotes } from '@/features/notes/api/queries';
import { NoOrganization } from '@/features/notes/components/NoOrganization';
import { NotesView } from '@/features/notes/components/NotesView';

export default async function NotesPage() {
  // auth.protect()는 미인증이면 sign-in으로 redirect하고, 인증되면 auth 객체를 반환한다.
  const { orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  const notes = await fetchNotes(orgId);
  return <NotesView notes={notes} />;
}
