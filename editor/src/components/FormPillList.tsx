import { useState, type ChangeEventHandler } from 'react';
import { handleFormBlur, T } from '../helpers';
import type { DocSelection, DocUser } from '../hooks/useProvider';

export type FormTextAreaProps = {
  id: string,
  title: string,
  values: string[],
  onChange: (newValues: string[]) => void,
  setAwareness: (data: Partial<DocSelection>) => void,
  selectors: { [el: string]: DocUser },
  uniqueValues?: boolean,
};

export const FormPillList = ({ id, title, values, uniqueValues, onChange, setAwareness, selectors }: FormTextAreaProps) => {
  const [newValue, setNewValue] = useState<string>('');

  return (
    <div className='inputGroup'>
      <label htmlFor={id}>{title}:</label>
      <div
        className='pill-list'
        style={selectors[id] ? {
          border: `0.1875rem solid ${selectors[id].color}`,
          margin: 'calc(-0.1875rem + 0.0625rem)',
        } : undefined}
      >
        <div className='d-flex flex-wrap gap-2'>
          {values.map((value, i) => (
            <div key={uniqueValues ? value : i} className='pill' onClick={() => {
              const newValues = [ ...values ];
              newValues.splice(i, 1);
              onChange(newValues);
            }}>
              #{value}
              <span className='material-symbols-outlined'>delete</span>
            </div>
          ))}
        </div>
        <input
          id={id}
          value={newValue}
          placeholder={T('New tags...')}
          onChange={({ target }) => setNewValue(target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              const formattedValue = newValue.slice(newValue.startsWith('#') ? 1 : 0);
              if (formattedValue && (!uniqueValues || !values.includes(formattedValue))) {
                onChange([ ...values, formattedValue ]);
              }
              setNewValue('');
            }
          }}
          data-selection-controlled={id}
          onFocus={() => setAwareness({ selectedElement: id })}
          onBlur={({ relatedTarget }) => handleFormBlur(relatedTarget as HTMLElement, setAwareness)}
        />
      </div>
    </div>
  );
};
