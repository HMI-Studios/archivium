function createSearchableSelect(id, options, onchange, groups={}) {
  const input = createElement('input');
  const valueInput = createElement('input', { attrs: { id, name: id, hidden: true } });
  const optionsContainer = createElement('div', { classList: ['options-container'] });
  const select = createElement('div', { classList: ['searchable-select'], children: [
    input,
    valueInput,
    optionsContainer,
  ] });

  select.setOptions = (options, groups={}) => {
    optionsContainer.innerHTML = '';
    const groupOptions = {};
    for (const key in options) {
      const option = createElement('div', { classList: ['option'], attrs: { value: key, innerText: options[key] } });
      if (groups[key]) {
        if (!(groups[key] in groupOptions)) {
          groupOptions[groups[key]] = createElement('div');
          groupOptions[groups[key]].appendChild(createElement('div', { classList: ['option-group-heading'], children: [
            createElement('b', { attrs: { innerText: groups[key] } })
          ] }));
        }
        groupOptions[groups[key]].appendChild(option);
      } else {
        optionsContainer.appendChild(option);
      }
    }
    for (const group in groupOptions) {
      optionsContainer.appendChild(groupOptions[group]);
    }
    setupListeners();
  };

  select.setOptions(options, groups);

  input.addEventListener('input', function() {
    valueInput.value = '';
    let filter = this.value.toLowerCase();
    let options = optionsContainer.querySelectorAll('div');
    options.forEach(function(option) {
      if (option.innerText.toLowerCase().includes(filter)) {
        option.style.display = '';
      } else {
        option.style.display = 'none';
      }
    });
  });

  input.addEventListener('focus', function() {
    optionsContainer.style.display = 'block';
  });

  input.addEventListener('blur', function() {
    setTimeout(function() { // Timeout to allow click event to register
      optionsContainer.style.display = 'none';
    }, 200);
  });

  function setupListeners() {
    optionsContainer.querySelectorAll('.option').forEach(function(option) {
      option.addEventListener('click', function() {
        valueInput.value = this.value;
        if (onchange) onchange(this.value);
        input.value = this.innerText;
        optionsContainer.style.display = 'none';
      });
    });
  }
  
  return select;
}
