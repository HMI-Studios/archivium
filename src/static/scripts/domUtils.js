function createElement(type, options={}) {
  const { attrs, classList, dataset, children, style } = options;
  const el = document.createElement(type);
  for (const attr in attrs ?? {}) {
    el[attr] = attrs[attr];
  }
  for (const key in style ?? {}) {
    el.style[key] = style[key];
  }
  for (const key in dataset ?? {}) {
    el.dataset[key] = dataset[key];
  }
  for (const cl of classList ?? []) {
    el.classList.add(cl);
  }
  for (const child of children ?? []) {
    if (child) el.appendChild(child);
  }
  return el;
}