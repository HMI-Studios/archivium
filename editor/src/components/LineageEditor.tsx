import { useState } from 'react';
import type { Item } from '../../../src/api/models/item';
import { capitalize, T } from '../helpers';
import SearchableSelect from './SearchableSelect';
import type { Categories, ItemOptionEntry } from '../pages/ItemEdit';

type LineageEditorProps = {
  item: Item,
  categories: Categories,
  onUpdate: (newItem: Partial<Item>) => void,
  itemMap: Record<string, ItemOptionEntry>,
};

export default function LineageEditor({ item, categories, onUpdate, itemMap }: LineageEditorProps) {
  const [newParent, setNewParent] = useState<string | null>(null);
  const [newParentSelfLabel, setNewParentSelfLabel] = useState<string>('');
  const [newParentOtherLabel, setNewParentOtherLabel] = useState<string>('');
  const [newChild, setNewChild] = useState<string | null>(null);
  const [newChildSelfLabel, setNewChildSelfLabel] = useState<string>('');
  const [newChildOtherLabel, setNewChildOtherLabel] = useState<string>('');

  const deleteParent = (index: number) => {
    const newState = { parents: structuredClone(item.parents) };
    newState.parents.splice(index, 1);
    onUpdate(newState);
  };

  const deleteChild = (index: number) => {
    const newState = { children: structuredClone(item.children) };
    newState.children.splice(index, 1);
    onUpdate(newState);
  };

  const addParent = () => {
    const newState = { ...item };
    if (!newParent) return;
    const existing = newState.parents.find((parent) => parent.parent_shortname === newParent);
    if (existing) {
      existing.child_label = newParentSelfLabel;
      existing.parent_label = newParentOtherLabel;
    } else {
      newState.parents.push({
        parent_shortname: newParent,
        parent_title: itemMap[newParent].title,
        child_label: newParentSelfLabel,
        parent_label: newParentOtherLabel,
      });
    }
    setNewParent(null);
    onUpdate(newState);
  };

  const addChild = () => {
    const newState = { ...item };
    if (!newChild) return;
    const existing = newState.children.find((child) => child.child_shortname === newChild);
    if (existing) {
      existing.parent_label = newChildSelfLabel;
      existing.child_label = newChildOtherLabel;
    } else {
      newState.children.push({
        child_shortname: newChild,
        child_title: itemMap[newChild].title,
        parent_label: newChildSelfLabel,
        child_label: newChildOtherLabel,
      });
    }
    setNewChild(null);
    onUpdate(newState);
  };

  const filteredItemKeys = Object.keys(itemMap).filter(key => itemMap[key].type in categories);
  const itemTitles = filteredItemKeys.reduce((acc, key) => ({ ...acc, [key]: itemMap[key].title }), {});
  const itemTypes = filteredItemKeys.reduce((acc, key) => ({ ...acc, [key]: capitalize(categories[itemMap[key].type][1]) }), {});
  const characterGroup = capitalize((categories['character'] ?? [])[1] ?? '');

  return <>
    <div className='item-parents'>
      <h4>{T('Parents')}</h4>
      {item.parents.map((parent, i) => (
        <div key={`parent_${i}`}>
          <button onClick={() => deleteParent(i)}>{parent.parent_title}</button>
          {parent.parent_label && <span>{parent.parent_label}</span>}
        </div>
      ))}
    </div>
    <div className='item-children'>
      <h4>{T('Children')}</h4>
      {item.children.map((child, i) => (
        <div key={`child_${i}`}>
          <button onClick={() => deleteChild(i)}>{child.child_title}</button>
          {child.child_label && <span>{child.child_label}</span>}
        </div>
      ))}
    </div>
    <div>
      <button onClick={addParent}>{T('Add New Parent')}</button>
      <SearchableSelect
        value={newParent ?? undefined}
        options={itemTitles}
        onSelect={setNewParent}
        groups={itemTypes}
        groupPriority={{ [characterGroup]: 1 }}
      />
      <input
        value={newParentSelfLabel}
        onChange={({ target }) => setNewParentSelfLabel(target.value)}
        placeholder={T('%s\'s Title', item.title)}
      />
      <input
        value={newParentOtherLabel}
        onChange={({ target }) => setNewParentOtherLabel(target.value)}
        placeholder={T('Parent Title')}
      />
    </div>
    <div>
      <button onClick={addChild}>{T('Add New Child')}</button>
      <SearchableSelect
        value={newChild ?? undefined}
        options={itemTitles}
        onSelect={setNewChild}
        groups={itemTypes}
        groupPriority={{ [characterGroup]: 1 }}
      />
      <input
        value={newChildSelfLabel}
        onChange={({ target }) => setNewChildSelfLabel(target.value)}
        placeholder={T('%s\'s Title', item.title)}
      />
      <input
        value={newChildOtherLabel}
        onChange={({ target }) => setNewChildOtherLabel(target.value)}
        placeholder={T('Child Title')}
      />
    </div>
  </>;
}
