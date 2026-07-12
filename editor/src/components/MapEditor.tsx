import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef, useState } from 'react';
import type { Item, Map, MapLocation } from '../../../src/api/models/item';
import { capitalize, postFormData, T } from '../helpers';
import type { Categories, ItemOptionEntry } from '../pages/ItemEdit';
import { createPortal } from 'react-dom';
import { HttpStatusCode } from 'axios';
import SearchableSelect from './SearchableSelect';

type MapEditorProps = {
  item: Item,
  categories: Categories,
  onUpdate: (newItem: Partial<Item>) => void,
  itemMap: Record<string, ItemOptionEntry>,
};

const remSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);

export default function MapEditor({ item, categories, onUpdate, itemMap }: MapEditorProps) {
  const [uploadModal, setUploadModal] = useState<boolean>(false);
  const [uploadModalError, setUploadModalError] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const modalAnchor = document.querySelector('#modal-anchor') as HTMLElement;

  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  
  const mouseSensor = useSensor(MouseSensor);
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 150,
      tolerance: 5,
    },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {});
  const sensors = useSensors(mouseSensor, touchSensor, keyboardSensor);

  const prepNewItem = (): { map: Map } => {
    return {
      map: item.map ? structuredClone(item.map) : {
        id: null,
        width: null,
        height: null,
        image_id: null,
        locations: [],
      },
    };
  }
  const addLocation = (location: MapLocation): void => {
    const newItem = prepNewItem();
    newItem.map.locations.push(location);
    onUpdate(newItem);
  };
  const removeLocation = (index: number): void => {
    const newItem = prepNewItem();
    if (!newItem.map.locations[index]) return;
    newItem.map.locations.splice(index, 1);
    if (selectedLocation === index) setSelectedLocation(null);
    onUpdate(newItem);
  };
  const modifyLocation = (index: number, fn: (location: MapLocation) => void): void => {
    const newItem = prepNewItem();
    const location = newItem.map.locations[index];
    if (!location) return;
    fn(location);
    onUpdate(newItem);
  };
  
  const itemTitles: Record<string, string> = Object.keys(itemMap).reduce((acc, key) => ({ ...acc, [key]: itemMap[key].title }), {});
  const itemTypes = Object.keys(itemMap).reduce((acc, key) => ({ ...acc, [key]: capitalize(categories[itemMap[key].type][1]) }), {});

  return <>
    <div className='map-editor'>
      <div
        ref={mapContainerRef}
        className={`map-container d-flex flex-col pa-2${item.map?.image_id === null ? ' square' : ''}`}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const rect = target.getBoundingClientRect();
          const x = Math.max(0, Math.min((e.clientX - rect.left - (remSize / 2)) / target.clientWidth, 1));
          const y = Math.max(0, Math.min((e.clientY - rect.top - (remSize / 2)) / target.clientHeight, 1));
          addLocation({
            id: null,
            title: null,
            universe: null,
            item: null,
            itemTitle: null,
            x, y,
          });
        }}
      >
        {item.map?.image_id && (
          <img className='w-100' src={`/api/universes/${item.universe_short}/items/${item.shortname}/map/image#${item.map.image_id}`} />
        )}
        <DndContext
          sensors={sensors}
          onDragEnd={(e) => {
            const { active, delta } = e;
            const container = mapContainerRef.current;
            if (!container) return;
            modifyLocation(Number(active.id), (location) => {
              location.x = Math.max(0, Math.min(location.x + (delta.x / container.clientWidth), 1));
              location.y = Math.max(0, Math.min(location.y + (delta.y / container.clientHeight), 1));
            });
          }}
          onDragStart={({ active }) => setSelectedLocation(Number(active.id))}
        >
          {item.map?.locations.map((location, i) => (
            <MapLocation
              index={i}
              label={
                location.title || (
                  location.item && location.universe === item.universe_short && location.itemTitle
                ) || 'Untitled Location'
              }
              x={location.x}
              y={location.y}
            />
          ))}
        </DndContext>
      </div>
      {item.map && selectedLocation !== null && <div className='d-flex flex-col gap-1 px-2'>
        <input
          value={item.map.locations[selectedLocation].title ?? ''}
          onChange={({ target }) => modifyLocation(selectedLocation, (location) => {
            location.title = target.value || null;
          })}
        />
        <SearchableSelect
          value={item.map.locations[selectedLocation].item ?? undefined}
          options={itemTitles}
          onSelect={(value) => modifyLocation(selectedLocation, (location) => {
            location.item = value;
            location.itemTitle = value && itemTitles[value];
            location.universe = item.universe_short;
          })}
          groups={itemTypes}
          clearText='None'
        />
        <button className='color-error' onClick={() => removeLocation(selectedLocation)}>Remove Location</button>
      </div>}
    </div>
    <br />
    <button type='button' onClick={() => setUploadModal(true)}>{T('Upload Image')}</button>
    {uploadModal && (
      createPortal(
        <div className='modal' onClick={() => setUploadModal(false)}>
          <div className='modal-content' onClick={(e) => e.stopPropagation()}>
            <div className='sheet d-flex flex-col gap-1 align-center'>
              <h2>{T('Upload Image')}</h2>
              <input type='file' accept='image/*' required></input>
              {uploadModalError && <div>
                <span id='item-error' className='color-error' style={{ fontSize: '0.875rem' }}>{uploadModalError}</span>
              </div>}
              {uploading && <div className='d-flex justify-center align-center'>
                <div className='loader ma-2'></div>
              </div>}
              <button type='button' onClick={async ({ target }) => {
                const imageInput = (target as HTMLElement).parentElement?.querySelector('input[type=file]') as HTMLInputElement;
                if (!imageInput.files) return;

                setUploading(true);

                const image = imageInput.files[0];
                const response = await postFormData(`/api/universes/${item.universe_short}/items/${item.shortname}/map/upload`, { image });
                const data = await response.json();

                if (response.status === HttpStatusCode.InsufficientStorage) {
                  setUploadModalError('There is not enough available storage to upload this image!');
                  setUploading(false);
                  return;
                }

                const newItem = prepNewItem();
                newItem.map.image_id = data.insertId;
                onUpdate(newItem);

                setUploadModal(false);
                setUploading(false);
              }}>{T('Upload')}</button>
            </div>
          </div>
        </div>,
        modalAnchor
      )
    )}
  </>;
}

interface MapLocationProps {
  index: number;
  label: string;
  x: number;
  y: number;
}

function MapLocation({
  index,
  label,
  x,
  y,
}: MapLocationProps) {
  const { attributes, isDragging, listeners, setNodeRef, transform } = useDraggable({
    id: index,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    top: `calc(${y * 100}% - ${y}rem)`,
    left: `calc(${x * 100}% - ${x}rem)`,
  }

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className='map-location'
      style={style}
    >
      <label className={x > 0.5 ? 'left' : 'right'}>{label}</label>
    </button>
  );
}
