import { useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';

type SearchableSelectProps = {
  id?: string,
  value?: string,
  options: { [shortname: string]: string },
  onSelect: (selectedValue: string | null) => void,
  groups?: { [shortname: string]: string },
  groupPriority?: { [group: string]: number },
  clearText?: string,
};

export default function SearchableSelect({ id, value, options, onSelect, groups, groupPriority, clearText }: SearchableSelectProps) {
  const [searchText, setSearchText] = useState<string>('');
  const [dropdownVisible, setDropdownVisible] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({
    top: 0,
    left: 0,
    width: 0,
  });

  useEffect(() => {
    if (!dropdownVisible || !inputRef.current) return;

    const rect = inputRef.current.getBoundingClientRect();

    setDropdownPos({
      top: rect.bottom,
      left: rect.left,
      width: rect.width,
    });

    const handleScroll = (e: Event) => {
      const target = e.target as Node;

      if (dropdownRef.current?.contains(target)) return;

      setDropdownVisible(false);
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (inputRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setDropdownVisible(false);
    };

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('mousedown', handleClick);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('mousedown', handleClick);
    };
  }, [dropdownVisible]);

  groups = groups ?? {};
  groupPriority = groupPriority ?? {};

  const filteredOptions = Object.keys(options).filter(option => (!searchText || !options[option] || options[option].toLowerCase().includes(searchText.toLowerCase())));

  const ungroupedOptions = filteredOptions.filter(key => !(key in groups));
  const groupedOptions = filteredOptions.filter(key => (key in groups));
  const optionGroups: { [key: string]: string[] } = {};
  for (const key of groupedOptions) {
    if (!(groups[key] in optionGroups)) optionGroups[groups[key]] = [];
    optionGroups[groups[key]].push(key);
  }

  const createOption = (key: string | null) => {
    return <div key={key} className='option' onClick={(e) => {
      e.stopPropagation();
      onSelect(key);
      setDropdownVisible(false);
      setSearchText('');
    }}>{key === null ? clearText : options[key]}</div>;
  };

  const optionItems: JSX.Element[] = [];
  for (const group of Object.keys(optionGroups).sort((a, b) => ((groupPriority[a] ?? 0) > (groupPriority[b] ?? 0) ? -1 : 1))) {
    optionItems.push(
      <div key={group} className='option-group-heading'>
        <b>{group}</b>
      </div>
    );
    for (const key of optionGroups[group]) {
      optionItems.push(createOption(key));
    }
  }

  return <div id={id} className='searchable-select'>
    <input
      ref={inputRef}
      value={dropdownVisible ? searchText : value && options[value] || ''}
      onChange={({ target }) => setSearchText(target.value)}
      onFocus={() => setDropdownVisible(true)}
      onClick={() => setDropdownVisible(true)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        if (filteredOptions.length === 1) {
          onSelect(filteredOptions[0]);
          setDropdownVisible(false);
          setSearchText('');
        }
      }}
    />
    {dropdownVisible && createPortal(
      <div
        ref={dropdownRef}
        className='options-container'
        data-select={id}
        style={{
          top: dropdownPos.top,
          left: dropdownPos.left,
          width: dropdownPos.width,
        }}
      >
        {clearText && createOption(null)}
        {ungroupedOptions.map((key) => createOption(key))}
        {optionItems}
      </div>,
      document.body,
    )}
  </div>;
}
