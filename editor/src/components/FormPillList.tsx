import { useState, type CSSProperties } from 'react';
import { handleFormBlur, T } from '../helpers';
import type { DocSelection, DocUser } from '../hooks/useProvider';

export type FormPillListProps = {
  id: string,
  title: string,
  values: string[],
  onChange: (newValues: string[]) => void,
  setAwareness?: (data: Partial<DocSelection>) => void,
  selectors?: { [el: string]: DocUser },
  containerStyles?: CSSProperties,
  uniqueValues?: boolean,
};

export const FormPillList = ({ id, title, values, uniqueValues, onChange, setAwareness, selectors, containerStyles }: FormPillListProps) => {
  if (!setAwareness) setAwareness = () => {};
  if (!selectors) selectors = {};

  const [newValue, setNewValue] = useState<string>('');

  const handleNewValues = (newValues: string[]): void => {
    const newFormattedValues: string[] = [];
    for (const value of newValues) {
      const formattedValue = value.slice(value.startsWith('#') ? 1 : 0);
      if (uniqueValues && (values.includes(formattedValue) || newFormattedValues.includes(formattedValue))) {
        continue;
      }
      if (formattedValue) {
        newFormattedValues.push(formattedValue);
      }
    }
    if (newFormattedValues.length > 0) {
      onChange([ ...values, ...newFormattedValues ]);
    }
  };

  return (
    <div className='inputGroup' style={containerStyles}>
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
              <span className='material-symbols-outlined clickable'>delete</span>
            </div>
          ))}
        </div>
        <input
          id={id}
          value={newValue}
          className='w-100'
          placeholder={T('New tags...')}
          onChange={(e) => {
            const inputValue = e.target.value;
            const newValues = inputValue.split(' ')
            const remainder = newValues.pop() ?? '';
            handleNewValues(newValues);
            setNewValue(remainder);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleNewValues([newValue])
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
