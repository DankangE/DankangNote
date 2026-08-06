import { auth } from '@clerk/nextjs/server';
import { getViewer } from '@/server/auth';
import { fetchFavoriteNoteIds, fetchNoteTree } from '@/features/notes/api/queries';
import { NotesNav } from '@/features/notes/components/NotesNav';
import { NoOrganization } from '@/lib/components/NoOrganization';

// 노트 셸(KAN-37) — 문서 트리 사이드바는 문서를 옮겨 다녀도 유지돼야 하므로 레이아웃에서
// 한 번만 그린다(채팅 셸과 같은 구조). 노트 변이 액션이 revalidatePath('/notes', 'layout')로
// 이 트리를 갱신한다.
export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = await auth.protect();
  if (!orgId) {
    return <NoOrganization />;
  }

  const [nodes, favoriteIds, viewer] = await Promise.all([
    fetchNoteTree(),
    fetchFavoriteNoteIds(),
    getViewer(),
  ]);

  return (
    <NotesNav nodes={nodes} favoriteIds={favoriteIds} viewer={viewer}>
      {children}
    </NotesNav>
  );
}
