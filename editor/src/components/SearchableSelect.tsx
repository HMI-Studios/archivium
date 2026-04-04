import { useState, type JSX } from 'react';

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
      value={dropdownVisible ? searchText : value && options[value] || ''}
      onChange={({ target }) => setSearchText(target.value)}
      onFocus={() => setDropdownVisible(true)}
      onBlur={() => setTimeout(() => setDropdownVisible(false), 100)} // Timeout to allow click event to register
    />
    <div className='options-container' style={{ display: dropdownVisible ? 'block' : 'none' }}>
      {clearText && createOption(null)}
      {ungroupedOptions.map((key) => createOption(key))}
      {optionItems}
    </div>
  </div>;
}
