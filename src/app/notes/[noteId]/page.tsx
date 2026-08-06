import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getViewer } from '@/server/auth';
import { fetchFavoriteNoteIds, fetchNote } from '@/features/notes/api/queries';
import { NoteDetail } from '@/features/notes/components/NoteDetail';
import { CenteredPage } from '@/lib/components/CenteredPage';
import { NoOrganization } from '@/lib/components/NoOrganization';

export default async function NotePage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const { orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  const { noteId } = await params;
  const [note, viewer, favoriteIds] = await Promise.all([
    fetchNote(noteId),
    getViewer(),
    fetchFavoriteNoteIds(),
  ]);
  // 없는 문서·남의 워크스페이스 문서는 같은 결과다. 404 대신 노트 착지점으로 돌려보낸다 —
  // 워크스페이스를 바꾼 직후 옛 문서 URL에 남아 있는 경우가 가장 흔한 원인이다(채팅과 같은 규칙).
  if (!note) {
    redirect('/notes');
  }

  return (
    <CenteredPage>
      <NoteDetail note={note} viewer={viewer} favorited={favoriteIds.includes(note.id)} />
    </CenteredPage>
  );
}
