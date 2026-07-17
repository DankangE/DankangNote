import { fetchNotes } from '@/features/notes/api/queries';
import { NotesView } from '@/features/notes/components/NotesView';

export default async function NotesPage() {
  const notes = await fetchNotes();
  return <NotesView notes={notes} />;
}
