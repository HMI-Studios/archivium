import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type UniqueIdentifier } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { HttpStatusCode } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { type GalleryImage } from '../../../src/api/models/item';
import { postFormData, T } from '../helpers';
import GalleryImageCard from './GalleryImageCard';

type GalleryProps = {
  universe: string,
  item: string,
  images: GalleryImage[];
  onRemoveImage: (id: number) => void,
  onUploadImages: (imgs: GalleryImage[]) => void,
  onChangeLabel: (id: number, label: string) => void,
  onReorderImages: (newImages: GalleryImage[]) => void,
};

export default function Gallery({ universe, item, images, onRemoveImage, onUploadImages, onChangeLabel, onReorderImages }: GalleryProps) {
  const [uploadModal, setUploadModal] = useState<boolean>(false);
  const [uploadModalError, setUploadModalError] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const modalAnchor = document.querySelector('#modal-anchor') as HTMLElement;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 5,
      },
    }),
  );

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

  const handleDragStart = useCallback((event: DragEndEvent) => {
    setActiveId(event.active.id);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      if (active.id !== over.id) {
        const oldIndex = images.findIndex(img => img.id === active.id);
        const newIndex = images.findIndex(img => img.id === over.id);
        const newOrder = arrayMove(images, oldIndex, newIndex);
        onReorderImages(newOrder);
      }
      setActiveId(null);
    },
    [onReorderImages]
  );

  const handleDragCancel = useCallback(() => setActiveId(null), []);

  return <>
    <div className='item-gallery d-flex gap-4 flex-wrap justify-center'>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={images.map(i => i.id)} strategy={rectSortingStrategy}>
          {images.map((img) => (
            <GalleryImageCard
              key={img.id}
              id={img.id}
              src={`/api/universes/${universe}/items/${item}/gallery/images/${img.id}`}
              label={img.label}
              onRemoveImage={onRemoveImage}
              onChangeLabel={onChangeLabel}
              isDragging={activeId === img.id}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
    <button type='button' onClick={() => setUploadModal(true)}>{T('Upload Image')}</button>
    {uploadModal && (
      createPortal(
        <div className='modal' onClick={() => setUploadModal(false)}>
          <div className='modal-content' onClick={(e) => e.stopPropagation()}>
            <div className='sheet d-flex flex-col gap-1 align-center'>
              <h2>{T('Upload Image')}</h2>
              <input type='file' accept='image/*' required multiple></input>
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

                const uploadedImages = [];
                for (const image of imageInput.files) {
                  const response = await postFormData(`/api/universes/${universe}/items/${item}/gallery/upload`, { image });
                  const data = await response.json();
  
                  if (response.status === HttpStatusCode.InsufficientStorage) {
                    setUploadModalError('There is not enough available storage to upload this image!');
                    setUploading(false);
                    return;
                  }
                  
                  uploadedImages.push({
                    id: data.insertId,
                    name: image.name,
                    label: '',
                  });
                }

                onUploadImages(uploadedImages);
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
