import type { ChangeEventHandler } from 'react';
import { handleFormBlur } from '../helpers';
import type { DocSelection, DocUser } from '../hooks/useProvider';

export type FormSwitchProps = {
  id: string,
  title: string,
  checked: boolean,
  onChange: ChangeEventHandler<HTMLInputElement>,
  setAwareness?: (data: Partial<DocSelection>) => void,
  selectors?: { [el: string]: DocUser },
};

export const FormSwitch = ({ id, title, checked, onChange, setAwareness, selectors }: FormSwitchProps) => {
  if (!setAwareness) setAwareness = () => {};
  if (!selectors) selectors = {};
  return (
    <div className='inputGroup'>
      <label htmlFor={id}>{title}:</label>
      <label className='switch'>
        <input
          id={id}
          name={id}
          type='checkbox'
          checked={checked}
          onChange={onChange}
          data-selection-controlled={id}
          onFocus={() => setAwareness({ selectedElement: id })}
          onBlur={({ relatedTarget }) => handleFormBlur(relatedTarget as HTMLElement, setAwareness)}
        />
        <span
          className='slider'
          style={selectors[id] ? { backgroundColor: selectors[id].color ?? '' } : undefined}
        />
      </label>
    </div>
  );
};
