import { useParams } from 'react-router';
import NoteEditor from '../components/NoteEditor';

export type NoteEditProps = {
  universeLink: (universe: string) => string,
};

export default function NoteEdit({ universeLink }: NoteEditProps) {
  const { noteUuid } = useParams();

  if (!noteUuid) {
    window.location.href = '/notes';
    return;
  }

  return (
    <>
      <h1 className='center'>Notes</h1>
      <NoteEditor noteUuid={noteUuid} universeLink={universeLink} />
    </>
  );
}
