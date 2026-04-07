import { useEditor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import type { Note, NoteItemTuple } from '../../../src/api/models/note';
import type { User } from '../../../src/api/models/user';
import { editorExtensions, extractLinkData, type LinkData, type TiptapContext } from '../../../src/lib/editor';
import { indexedToJson, jsonToIndexed } from '../../../src/lib/tiptapHelpers';
import { BulkExistsFetcher, fetchAsync, fetchData, T } from '../helpers';
import EditorFrame from './EditorFrame';
import { FormPillList } from './FormPillList';
import { FormSwitch } from './FormSwitch';
import SaveBtn from './SaveBtn';
import SearchableSelect from './SearchableSelect';

export type NoteEditorProps = {
  noteUuid: string,
  universeLink: (universe: string) => string,
};

export type ItemOptionEntry = { title: string, universe: string, universe_short: string };

const itemExistsCache: { [universe: string]: { [item: string]: boolean } } = {};

export default function NoteEditor({ noteUuid, universeLink }: NoteEditorProps) {
  const [initContent, setInitContent] = useState<any | null>(null);
  const [authorName, setAuthorName] = useState<string>();
  const [note, setNote] = useState<Note | null>(null);
  const [itemMap, setItemMap] = useState<Record<string, ItemOptionEntry>>();

  const context: TiptapContext = {
    currentUniverse: null,
    universeLink,
    itemExists(universe, item): boolean {
      return (itemExistsCache[universe] ?? {})[item] ?? false;
    },
    headings: [],
  };

  const editor = useEditor({
    extensions: editorExtensions(true, context),
    onUpdate: ({ editor }) => {
      if (!note) return;
      const json = editor.getJSON();
      const indexed = jsonToIndexed(json);
      setNote({ ...note, body: indexed });
    },
  });

  useEffect(() => {
    fetchData(`/api/me`, async (user: User) => {
      setAuthorName(user.username);
      const noteData = await fetchAsync(`/api/users/${user.username}/notes/${noteUuid}`) as Note;
      if (noteData.body) {
        const links: LinkData[] = [];
        const json = indexedToJson(noteData.body, (href) => links.push(extractLinkData(href)));
        const bulkFetcher = new BulkExistsFetcher();
        const fetchPromises = links.map(async (link) => {
          if (link.item) {
            const universe = link.universe;
            if (!universe) return;
            if (!(universe in itemExistsCache)) {
              itemExistsCache[universe] = {};
            }
            if (!(link.item in itemExistsCache[universe])) {
              itemExistsCache[universe][link.item] = await bulkFetcher.exists(universe, link.item);
            }
          }
        });
        void bulkFetcher.fetchAll();

        // TODO we'd like to use perms.WRITE here instead of hardcoding "3" but that currently breaks webpack.
        const itemMapPromise = fetchData('/api/items?perms=3', (items) => {
          const newItemMap: Record<number, ItemOptionEntry> = {};
          for (const { shortname, title, universe, universe_short } of items) {
            newItemMap[shortname] = { title, universe, universe_short };
          }
          setItemMap(newItemMap);
        });

        await Promise.all([...fetchPromises, itemMapPromise]);
        setInitContent(json);
      }
      setNote(noteData);
    });
  }, [noteUuid]);

  useEffect(() => {
    if (editor && initContent) {
      editor.commands.setContent(initContent);
    }
  }, [editor, initContent]);

  /* Loading Screen */
  if (!note || !itemMap || !authorName) {
    return <div className='d-flex justify-center align-center'>
      <div className='loader' style={{ marginTop: 'max(0px, calc(50vh - 50px - var(--page-margin-top)))' }}></div>
    </div>;
  }

  const itemTitles = itemMap ? Object.keys(itemMap).reduce((acc, key) => ({ ...acc, [`${itemMap[key].universe_short}/${key}`]: itemMap[key].title }), {}) : {};
  const itemUniverses = itemMap ? Object.keys(itemMap).reduce((acc, key) => ({ ...acc, [`${itemMap[key].universe_short}/${key}`]: itemMap[key].universe }), {}) : {};

  const query = new URLSearchParams(window.location.search);
  const backLink = query.get('returnTo') ?? '/notes';

  return (
    <div className='notes'>
      <div id='note-edit'>
        <EditorFrame
          id='main-editor'
          editor={editor}
          getLink={async (url, type) => {
            if (url?.startsWith('@')) {
              if (type === 'link') {
                const link = extractLinkData(url);
                if (link.item && link.universe) {
                  if (!(link.universe in itemExistsCache)) {
                    itemExistsCache[link.universe] = {};
                  }
                  if (!(link.item in itemExistsCache[link.universe])) {
                    const existsFetcher = new BulkExistsFetcher();
                    const fetchPromise = existsFetcher.exists(link.universe, link.item);
                    existsFetcher.fetchAll();
                    itemExistsCache[link.universe][link.item] = await fetchPromise;
                  }
                }
              }
            }

            return [url];
          }}
          itemTitles={itemTitles}
          itemGroups={itemUniverses}
        />
      </div>

      <div>
        <div id='note-controls' className='sheet' style={{ position: 'sticky', top: '4rem' }}>
          <div id='edit' className='form-row-group'>
            <div className='inputGroup'>
              <label htmlFor='title'>{T('Title')}:</label>
              <input id='title' type='text' name='title' value={note.title} onChange={({ target }) =>
                setNote({ ...note, title: target.value })
              } />
            </div>

            <FormSwitch
              id='comments'
              title={T('Public')}
              checked={note.is_public}
              onChange={({ target }) => setNote({ ...note, is_public: target.checked })}
            />

            <label>{T('Linked items')}:</label>
            <ul className='ma-0 pa-0'>
              {note.items && note.items.map(([title, shortname, _, universe_short]) => (
                <li key={`${universe_short}/${shortname}`} className='d-flex align-center'>
                  <a className='material-symbols-outlined link' onClick={() => {
                    if (!note.items) return;
                    const newItems: NoteItemTuple[] = [];
                    for (const item of note.items) {
                      if (item[1] === shortname && item[3] === universe_short) continue;
                      newItems.push([...item]);
                    }
                    setNote({ ...note, items: newItems });
                  }}>delete</a>
                  <a target='_blank' className='link link-animated' href={`${universeLink(universe_short)}/items/${shortname}`}>{title}</a>
                </li>
              ))}
            </ul>

            <SearchableSelect
              options={itemTitles}
              onSelect={(value) => {
                if (!value) return;
                const newItems = structuredClone(note.items ?? []);
                newItems.push([itemMap[value].title, value, itemMap[value].universe, itemMap[value].universe_short]);
                setNote({ ...note, items: newItems })
              }}
              groups={itemUniverses}
            />

            <FormPillList
              id='tags'
              title={T('Tags')}
              values={note.tags ?? []}
              onChange={(tags) => setNote({ ...note, tags })}
              containerStyles={{ gridTemplateColumns: '1fr' }}
              uniqueValues={true}
            />

            <SaveBtn<Note>
              data={note}
              saveUrl={`/api/users/${authorName}/notes/${noteUuid}`}
            />

            <button onClick={async () => {
              if (!confirm('Are you sure you want to delete this note? This cannot be undone!')) return;
              await fetch(`/api/users/${authorName}/notes/${noteUuid}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: {
                  'Accept': 'application/json',
                },
              });
              window.onbeforeunload = null;
              window.location.href = '/notes';
            }}>Delete</button>

            <a className='button-link' href={backLink}>Back to List</a>
          </div>
        </div>
      </div>
    </div>
  );
}
