import type { SetImageOptions } from '@tiptap/extension-image';
import { Editor } from '@tiptap/react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router';
import * as Y from 'yjs';
import { type BuiltinTab, type Item, type ObjData } from '../../../src/api/models/item';
import { editorExtensions, extractLinkData, type LinkData, type TiptapContext } from '../../../src/lib/editor';
import { splitIgnoringQuotes } from '../../../src/lib/markdown';
import { indexedToJson, jsonToIndexed } from '../../../src/lib/tiptapHelpers';
import CustomDataEditor from '../components/CustomDataEditor';
import EditorFrame from '../components/EditorFrame';
import { FormPillList } from '../components/FormPillList';
import { FormInput } from '../components/FormInput';
import { FormSelect } from '../components/FormSelect';
import { FormSwitch } from '../components/FormSwitch';
import Gallery from '../components/Gallery';
import LineageEditor from '../components/LineageEditor';
import MapEditor from '../components/MapEditor';
import SaveBtn from '../components/SaveBtn';
import TabsBar from '../components/TabsBar';
import TimelineEditor from '../components/TimelineEditor';
import { BulkExistsFetcher, capitalize, fetchData, T } from '../helpers';
import { useProvider } from '../hooks/useProvider';
import { useYState } from '../hooks/useYState';

export type Categories = {
  [key: string]: [string, string],
};

export type EventItem = [string, string, number, string, number];
export type ItemOptionEntry = { title: string, type: string, tags: string[] };

type ModalType = 'newTab';

export type ItemEditProps = {
  universeLink: (universe: string) => string,
  providerAddress: string,
};

export const BUILTIN_TABS: BuiltinTab[] = ['lineage', 'map', 'timeline', 'gallery'];

function computeTabs(objData: ObjData): Record<string, string> {
  return {
    ...(objData.body ? { body: T('Main Text') } : {}),
    ...(objData.tabs ? Object.keys(objData.tabs) : []).reduce((acc, tab) => ({ ...acc, [tab]: tab }), {}),
    ...BUILTIN_TABS.filter(tab => objData[tab] !== undefined).reduce((acc, tab) => ({ ...acc, [tab]: objData[tab].title }), {}),
  };
}

const itemExistsCache: { [universe: string]: { [item: string]: boolean } } = {};

const ydoc = new Y.Doc();
const yItem = ydoc.getMap('item');
const yObjData = ydoc.getMap('obj_data');

async function warmItemExistsCache(shorthand: string, defaultUniverse: string): Promise<void> {
  const link = extractLinkData(shorthand);
  if (!link.item) return;
  const universe = link.universe ?? defaultUniverse;
  if (!(universe in itemExistsCache)) itemExistsCache[universe] = {};
  if (!(link.item in itemExistsCache[universe])) {
    const existsFetcher = new BulkExistsFetcher();
    const fetchPromise = existsFetcher.exists(universe, link.item);
    existsFetcher.fetchAll();
    itemExistsCache[universe][link.item] = await fetchPromise;
  }
}

function syncItemExistsCache() {
  const remoteCache = ydoc.getMap('config').get('itemExistsCache') as typeof itemExistsCache | undefined;
  if (remoteCache) {
    for (const universe in remoteCache) {
      if (!(universe in itemExistsCache)) {
        itemExistsCache[universe] = {};
      }
      for (const item in remoteCache[universe]) {
        itemExistsCache[universe][item] = remoteCache[universe][item];
      }
    }
  }
}

export default function ItemEdit({ universeLink, providerAddress }: ItemEditProps) {
  const navigate = useNavigate();
  const { universeShort, itemShort } = useParams();

  if (!universeShort || !itemShort) return;

  const [item, setItem, changeItem] = useYState<Item>(yItem);
  const [objData, setObjData, changeObjData] = useYState<ObjData>(yObjData);

  const [categories, setCategories] = useState<Categories | null>(null);
  const [currentModal, setCurrentModal] = useState<ModalType | null>(null);
  const [currentTab, setCurrentTab] = useState<string | null>(null);
  const [eventItemMap, setEventItemMap] = useState<Record<string, EventItem[]>>();
  const [itemMap, setItemMap] = useState<Record<string, ItemOptionEntry>>();
  const itemMapRef = useRef<Record<string, ItemOptionEntry>>({});

  const [loading, setLoading] = useState(true);

  const context: TiptapContext = {
    currentUniverse: universeShort,
    universeLink,
    itemExists(universe, item): boolean {
      return (itemExistsCache[universe] ?? {})[item] ?? false;
    },
    resolveItemExists: (shorthand) => warmItemExistsCache(shorthand, universeShort),
    headings: [],
    items: () => itemMapRef.current,
  };

  const [editor, setEditor] = useState<Editor | null>(null);

  const [provider, error, docUsers, docSelectors, setAwareness] = useProvider(providerAddress, `item/${universeShort}/${itemShort}`, ydoc);

  useEffect(() => {
    if (provider && !editor) {
      const handleSync = async () => {
        syncItemExistsCache();
        const editor = new Editor({
          extensions: editorExtensions(true, context, { ydoc, field: 'main', provider }),
          onUpdate: ({ editor }) => {
            const json = editor.getJSON();
            const indexed = jsonToIndexed(json);
            changeObjData({ body: indexed });
          },
        });
        setEditor(editor);
      };

      if (provider.isSynced) handleSync();
      else provider.on('synced', handleSync);
    }
  }, [provider]);

  useEffect(() => {
    if (provider && editor) {
      const categoryPromise = fetchData(`/api/universes/${universeShort}`, (data) => {
        setCategories(data.obj_data.cats);
      });
      const eventItemPromise = fetchData(`/api/universes/${universeShort}/events`, (events) => {
        const newEventItemMap: Record<number, EventItem[]> = {};
        for (const { src_id, src_title, src_shortname, event_title, abstime } of events) {
          if (!(src_id in newEventItemMap)) {
            newEventItemMap[src_id] = [];
          }
          newEventItemMap[src_id].push([src_shortname as string, src_title as string, Number(src_id), event_title ?? '', Number(abstime)]);
        }
        setEventItemMap(newEventItemMap);
      });
      const itemMapPromise = fetchData(`/api/universes/${universeShort}/items`, (items) => {
        const newItemMap: Record<number, ItemOptionEntry> = {};
        for (const { shortname, title, item_type, tags } of items) {
          if (shortname === itemShort) continue;
          newItemMap[shortname] = { title, type: item_type, tags: tags ?? [] };
        }
        itemMapRef.current = newItemMap;
        setItemMap(newItemMap);
      });

      Promise.all([categoryPromise, eventItemPromise, itemMapPromise]).then(async () => {
        // The editor doesn't get created until the provider syncs, so we're guaranteed to be synced here
        if (!ydoc.getMap('config').get('initialContentLoading')) {
          ydoc.getMap('config').set('initialContentLoading', true);

          await fetchData(`/api/universes/${universeShort}/items/${itemShort}`, async (data: Item) => {
            const objData = data.obj_data;
            let initialContent: Object | null = null;
            if (objData.body) {
              const links: LinkData[] = [];
              initialContent = indexedToJson(objData.body, (href) => links.push(extractLinkData(href)));
              const bulkFetcher = new BulkExistsFetcher();
              const fetchPromises = links.map(async (link) => {
                if (link.item) {
                  const universe = link.universe ?? universeShort;
                  if (!(universe in itemExistsCache)) {
                    itemExistsCache[universe] = {};
                  }
                  if (!(link.item in itemExistsCache[universe])) {
                    itemExistsCache[universe][link.item] = await bulkFetcher.exists(universe, link.item);
                  }
                }
              });
              bulkFetcher.fetchAll();
              await Promise.all(fetchPromises);
              ydoc.getMap('config').set('itemExistsCache', itemExistsCache);
            }
            // delete data.obj_data;

            if (ydoc.getMap('config').get('initialContentLoaded')) {
              // Someone else beat us to loading it first, return
              return;
            }
            ydoc.getMap('config').set('initialContentLoaded', true);

            if (initialContent) {
              editor.commands.setContent(initialContent);
            }
            setItem(data);
            setObjData(objData);
          });
        }
        setLoading(false);
      });
    }
  }, [itemShort, universeShort, provider, editor]);

  const tabNames = computeTabs(objData);
  if (!(currentTab && tabNames[currentTab])) {
    if (Object.keys(tabNames).length > 0) setCurrentTab(Object.keys(tabNames)[0]);
    else if (currentTab !== null) setCurrentTab(null);
  }

  useEffect(() => {
    if (provider?.isSynced) {
      if (currentModal === 'newTab') {
        setAwareness({ tab: '+' });
      } else {
        setAwareness({ tab: currentTab });
      }
    }
  }, [currentTab, currentModal, provider?.isSynced]);

  const modalAnchor = document.querySelector('#modal-anchor');

  const [newTabType, setNewTabType] = useState<string | undefined>(undefined);
  const [newTabName, setNewTabName] = useState<string>('');
  function addTabByType() {
    if (newTabType === undefined) return;
    const newObjData = structuredClone(objData);
    if (BUILTIN_TABS.includes(newTabType as typeof BUILTIN_TABS[number])) {
      newObjData[newTabType as typeof BUILTIN_TABS[number]] = { title: capitalize(T(newTabType)) };
    } else if (newTabType === 'body') {
      newObjData.body = { text: '', structure: [] };
    } else if (newTabType === 'custom') {
      if (!newTabName) return;
      if (!newObjData.tabs) newObjData.tabs = {};
      newObjData.tabs[newTabName] = {};
    }
    setObjData(newObjData);
    setCurrentModal(null);
  }
  function removeTab(tab: string) {
    const newObjData = structuredClone(objData);
    if (BUILTIN_TABS.includes(tab as typeof BUILTIN_TABS[number])) {
      delete newObjData[tab as typeof BUILTIN_TABS[number]];
    } else if (tab === 'body') {
      delete newObjData.body;
    } else if (newObjData.tabs) {
      if (!newObjData.tabs[tab]) return;
      delete newObjData.tabs[tab];
    }
    setObjData(newObjData);
  }

  /* Error Screen */
  if (error) {
    return <div className='d-flex justify-center align-center'>
      <div className='d-flex flex-col align-center gap-2' style={{ marginTop: 'max(0px, calc(50vh - 50px - var(--page-margin-top)))' }}>
        <span className='color-error big-text'>{error}</span>
        <button className='px-2' onClick={() => location.reload()}>Reload</button>
        <button
          className='px-2'
          onClick={() => location.href = `${context.universeLink(universeShort)}/items/${itemShort}`}
        >Go Back</button>
      </div>
    </div>;
  }

  /* Loading Screen */
  if (loading || !categories || !itemMap || !editor) {
    return <div className='d-flex justify-center align-center'>
      <div className='loader' style={{ marginTop: 'max(0px, calc(50vh - 50px - var(--page-margin-top)))' }}></div>
    </div>;
  }

  const modals: Record<ModalType, ReactElement> = {
    newTab: (
      <div className='sheet d-flex flex-col gap-1' style={{ minWidth: '20rem' }}>
        <select onChange={({ target }) => setNewTabType(target.value)}>
          <option hidden disabled selected value={undefined}>{T('Tab Type')}...</option>
          <option value='body' disabled={'body' in objData}>{T('Main Text')}</option>
          {BUILTIN_TABS.map(type => (
            <option key={type} value={type} disabled={type in tabNames}>{capitalize(T(type))}</option>
          ))}
          <option value='custom'>{T('Custom Data')}</option>
        </select>
        {newTabType === 'custom' && <input type='text' placeholder={T('Tab Name')} value={newTabName} onChange={({ target }) => setNewTabName(target.value)} />}
        <button type='button' onClick={() => addTabByType()}>{T('New Tab')}</button>
      </div>
    ),
  };

  const customTabs: Record<string, ReactElement> = {};
  for (const tab in objData.tabs) {
    customTabs[tab] = <CustomDataEditor data={objData.tabs[tab]} onUpdate={(newData) => {
      const newState = { tabs: structuredClone(objData.tabs) };
      if (!newState.tabs) newState.tabs = {};
      newState.tabs[tab] = newData;
      changeObjData(newState);
    }} />;
  }

  const filteredItemKeys = Object.keys(itemMap).filter(key => itemMap[key].type in categories);
  const itemTitles = itemMap ? filteredItemKeys.reduce((acc, key) => ({ ...acc, [key]: itemMap[key].title }), {}) : {};
  const itemTypes = (itemMap && categories) ? filteredItemKeys.reduce((acc, key) => ({ ...acc, [key]: capitalize(categories[itemMap[key].type][1]) }), {}) : {};

  const tabs: Record<string, ReactElement | null> = {
    ...customTabs,
    body: (
      <EditorFrame
        id='main-editor'
        editor={editor}
        getLink={async (url, type) => {
          if (url?.startsWith('@')) {
            if (type === 'link') {
              await warmItemExistsCache(url, universeShort);
            } else if (type === 'image') {
              const [cmd, index, alt, height, width] = splitIgnoringQuotes(url.substring(1));
              if (cmd === 'img') {
                const image = item.gallery[Number(index)];
                if (image) {
                  const attrs: Partial<SetImageOptions> = {
                    alt: alt ?? image.name,
                    title: alt ?? image.label,
                  };
                  if (height) attrs.height = Number(height);
                  if (width) attrs.width = Number(width);
                  return [`/api/universes/${item.universe_short}/items/${item.shortname}/gallery/images/${image.id}`, attrs];
                }
              }
            }
          }

          return [url];
        }}
        itemTitles={itemTitles}
        itemGroups={itemTypes}
        gallery={item.gallery}
      />
    ),
    gallery: (
      <Gallery universe={universeShort} item={itemShort} images={item.gallery} onRemoveImage={(id) => {
        const newState = { gallery: structuredClone(item.gallery) };
        for (let i = 0; i < newState.gallery.length; i++) {
          const img = newState.gallery[i];
          if (img.id === id) {
            newState.gallery.splice(i, 1);
            break;
          }
        }
        changeItem(newState);
      }} onUploadImages={(imgs) => {
        const newState = { gallery: structuredClone(item.gallery) };
        for (const img of imgs) {
          newState.gallery.push(img);
        }
        changeItem(newState);
      }} onChangeLabel={(id, label) => {
        const newState = { gallery: structuredClone(item.gallery) };
        for (let i = 0; i < newState.gallery.length; i++) {
          const img = newState.gallery[i];
          if (img.id === id) {
            img.label = label;
            break;
          }
        }
        changeItem(newState);
      }} onReorderImages={(newImages) => {
        changeItem({
          gallery: newImages,
        });
      }} />
    ),
    map: (
      <MapEditor item={item} categories={categories} onUpdate={(newItem) => changeItem(newItem)} itemMap={itemMap} />
    ),
    timeline: (
      <TimelineEditor item={item} onEventsUpdate={(newEvents) => {
        const newState = { events: structuredClone(item.events) };
        newState.events = newEvents;
        changeItem(newState);
      }} eventItemMap={eventItemMap ?? {}} />
    ),
    lineage: (
      <LineageEditor item={item} categories={categories} onUpdate={(newItem) => changeItem(newItem)} itemMap={itemMap} />
    ),
  };

  return (
    <>
      {/* Modals */}
      {modalAnchor && (
        currentModal && createPortal(
          <div className='modal' onClick={() => setCurrentModal(null)}>
            <div className='modal-content' onClick={(e) => e.stopPropagation()}>
              {modals[currentModal]}
            </div>
          </div>,
          modalAnchor
        )
      )}

      {/* Editor Page */}
      <div className='d-flex justify-between align-baseline'>
        <h2>{T('Edit %s', item.title)}</h2>
        <a
          className='link link-animated color-error'
          href={item.shortname.startsWith('_') ? `${context.universeLink(universeShort)}/edit` : `${context.universeLink(universeShort)}/items/${itemShort}`}
        >{T('Discard Changes')}</a>
      </div>

      {/* Document user icons */}
      {docUsers.length > 1 && (
        <div className='d-flex flex-wrap mb-4'>
          {docUsers.map((user) => (
            <img key={user.clientId} src={user.pfp} title={user.name} style={{
              border: `0.1875rem solid ${user.color}`,
              borderRadius: '50%',
              width: '2.5rem',
              marginRight: '-1.25rem',
            }} />
          ))}
        </div>
      )}

      <div id='edit' className='form-row-group'>
        <FormInput
          id='title'
          title={T('Title')}
          value={item.title}
          onChange={({ target }) =>
            changeItem({ title: target.value })
          }
          setAwareness={setAwareness}
          selectors={docSelectors.selectedElement}
        />

        <FormInput
          id='shortname'
          title={T('Shortname')}
          value={item.shortname}
          onChange={({ target }) =>
            changeItem({ shortname: target.value })
          }
          setAwareness={setAwareness}
          selectors={docSelectors.selectedElement}
        />

        <div className='inputGroup'>
          <small style={{ gridColumn: '2 / 4' }}>
            <i>{T('NOTE: other users currently editing this item will be unable to save their work. Change with caution.')}</i>
          </small>
        </div>

        <FormSelect
          id='item_type'
          title={T('Type')}
          value={item.item_type}
          options={categories && item ? Object.keys(categories).reduce((acc, type) => ({ ...acc, [type]: capitalize(categories[type][0]) }), {}) : {}}
          onChange={({ target }) => changeItem({ item_type: target.value })}
          setAwareness={setAwareness}
          selectors={docSelectors.selectedElement}
        />

        <FormPillList
          id='tags'
          title={T('Tags')}
          values={item.tags ?? []}
          onChange={(tags) => changeItem({ tags })}
          setAwareness={setAwareness}
          selectors={docSelectors.selectedElement}
          uniqueValues={true}
        />

        <FormSwitch
          id='comments'
          title={T('Enable comments')}
          checked={objData?.comments ?? false}
          onChange={({ target }) => changeObjData({ comments: target.checked })}
          setAwareness={setAwareness}
          selectors={docSelectors.selectedElement}
        />

        <FormSwitch
          id='notes'
          title={T('Enable notes')}
          checked={objData?.notes ?? false}
          onChange={({ target }) => changeObjData({ notes: target.checked })}
          setAwareness={setAwareness}
          selectors={docSelectors.selectedElement}
        />

        <div className='mt-2'>
          <SaveBtn<Item>
            data={{ ...item, obj_data: objData }}
            saveUrl={`/api/universes/${universeShort}/items/${itemShort}`}
            previewUrl={item.shortname.startsWith('_') ? `${context.universeLink(universeShort)}/edit` : `${context.universeLink(universeShort)}/items/${item.shortname}`}
            previewText={item.shortname.startsWith('_') ? T('Return') : undefined}
            onSave={(data) => {
              if (data.shortname !== itemShort) {
                navigate(`/editor/universes/${universeShort}/items/${data.shortname}`);
              }
            }}
          />
        </div>

        <hr className='w-100 mb-0' />

        {objData && <div>
          <div className='d-flex align-start mb-2'>
            <TabsBar
              tabs={tabNames}
              selectedTab={currentTab}
              onSelectTab={(tab) => setCurrentTab(tab)}
              onRemoveTab={(tab) => removeTab(tab)}
              selectors={docSelectors.tab}
            />
            <ul className='navbarBtns'>
              <li className='navbarBtn badge-anchor'>
                {docSelectors.tab['+'] && docSelectors.tab['+'].map((user, i) => (
                  <img key={user.clientId} src={user.pfp} className='badge' style={{
                    left: `${-0.5 + (0.5 * i)}rem`,
                    backgroundColor: user.color ?? '',
                  }} />
                ))}
                <h3 id='add-tab' className='navbarBtnLink navbarText ma-0 material-symbols-outlined heavy' onClick={() =>  setCurrentModal('newTab')}>add</h3>
              </li>
            </ul>
          </div>

          {currentTab && (
            <div data-tab={currentTab}>
              {tabs[currentTab]}
            </div>
          )}
        </div>}
      </div>
    </>
  );
}
