import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';

const ChapterEdit = lazy(() => import(/* webpackChunkName: "chapter-edit" */ './pages/ChapterEdit'));
const ItemEdit = lazy(() => import(/* webpackChunkName: "item-edit" */ './pages/ItemEdit'));
const NoteEdit = lazy(() => import(/* webpackChunkName: "note-edit" */ './pages/NoteEdit'));

export type AppProps = {
  displayUniverse: string,
  addrPrefix: string,
  domain: string,
  providerAddress: string,
};

export default function App({ displayUniverse, addrPrefix, domain, providerAddress }: AppProps) {
  function universeLink(universe: string): string {
    if (displayUniverse) {
      if (displayUniverse === universe) return addrPrefix;
      else return `https://${domain}${addrPrefix}/universes/${universe}`;
    } else {
      return `${addrPrefix}/universes/${universe}`;
    }
  }

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path='editor'>
          <Route path='universes'>
            <Route path=':universeShort'>
              <Route path='items'>
                <Route path=':itemShort' element={<ItemEdit universeLink={universeLink} providerAddress={providerAddress} />} />
              </Route>
            </Route>
          </Route>
          <Route path='stories'>
            <Route path=':storyShort'>
              <Route path=':chapterIndex' element={<ChapterEdit universeLink={universeLink} />} />
            </Route>
          </Route>
        </Route>
        <Route path='notes'>
          <Route path=':noteUuid' element={<NoteEdit universeLink={universeLink} />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
