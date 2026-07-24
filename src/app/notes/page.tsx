import { auth } from '@clerk/nextjs/server';
import { getViewer } from '@/server/auth';
import { fetchNotes } from '@/features/notes/api/queries';
import { NoOrganization } from '@/lib/components/NoOrganization';
import { NotesView } from '@/features/notes/components/NotesView';

export default async function NotesPage() {
  // auth.protect()는 미인증이면 sign-in으로 redirect하고, 인증되면 auth 객체를 반환한다.
  const { orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  // viewer는 편집·삭제 버튼 노출용(편의) — 실제 권한 강제는 액션/서비스에서 한다(KAN-18).
  const [notes, viewer] = await Promise.all([fetchNotes(), getViewer()]);
  return <NotesView notes={notes} viewer={viewer} />;
}
