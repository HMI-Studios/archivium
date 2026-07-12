import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { debounce, T } from '../helpers';
import { deepCompare } from '../../../src/lib/utils';

export interface SaveBtnProps<T> {
  data: T | null;
  saveUrl: string;
  previewUrl?: string | ((data: unknown) => string);
  previewText?: string;
  onSave?: (data: T) => void;
}

let needsSaving = false;
function setNeedsSaving(value: boolean) {
  needsSaving = value;
}
window.onbeforeunload = (event) => {
  if (needsSaving) {
    event.preventDefault();
    event.returnValue = true;
  }
};
let saveTimeout: NodeJS.Timeout | null = null;

export default function SaveBtn<T>({ data, saveUrl, previewUrl, previewText, onSave }: SaveBtnProps<T>) {
  const [saveText, setSaveText] = useState<string>('Save Changes');
  const [previousData, setPreviousData] = useState<T | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [debounceTimout, setDebounceTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (data) {
      setNeedsSaving(true);
      setSaveText('Save Changes');
      const newTimeout = debounce(debounceTimout, () => save(5000), 500);
      setDebounceTimeout(newTimeout);
    }
  }, [data]);

  async function save(delay: number, callback?: (data?: unknown) => void) {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(async () => {
      if (!data) return;
      setSaveText('Saving...');
      console.log('SAVING...');

      const saveData = structuredClone(data);
      if (deepCompare(saveData, previousData)) {
        console.log('NO CHANGE');
        setSaveText('Saved');
        setNeedsSaving(false);
        if (callback) callback();
        return;
      }

      try {
        setErrorMessage(null);
        const response = await fetch(saveUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });
        const responseData = await response.json();
        if (!response.ok) {
          if (typeof responseData === 'string') setErrorMessage(responseData);
          throw responseData;
        }
        console.log('SAVED.');
        setSaveText('Saved');
        setPreviousData(saveData);
        setNeedsSaving(false);
        if (callback) callback(responseData);
        if (onSave) onSave(saveData);
      } catch (err) {
        console.error('Failed to save!');
        console.error(err);
        setSaveText('Error');
        setPreviousData(null);
        if (err instanceof TypeError) {
          setErrorMessage('Network error. Make sure you are connected to the internet and try again.');
        }
      }
    }, delay);
  }

  const saveBtnAnchor = document.querySelector('#save-btn');
  const previewBtnAnchor = document.querySelector('#preview-btn');

  return <>
    {saveBtnAnchor && createPortal(
      <a className='navbarBtnLink navbarText' onClick={() => save(0)}>{T(saveText)}</a>,
      saveBtnAnchor,
    )}
    {previewUrl && previewBtnAnchor && createPortal(
      <a className='navbarBtnLink navbarText' onClick={() => save(0, (data) => {
        if (typeof previewUrl === 'string') {
          location.href = previewUrl;
        } else {
          location.href = previewUrl(data);
        }
      })}>{previewText ?? T('Preview')}</a>,
      previewBtnAnchor,
    )}
    <button id='save-changes' onClick={() => save(0)}>{T(saveText)}</button>
    {errorMessage && <div>
      <span id='item-error' className='color-error' style={{ fontSize: 'small' }}>{errorMessage}</span>
    </div>}
  </>;
}
