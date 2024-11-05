if (!window.createElement) throw 'domUtils.js not loaded!';

class Timeline {
  constructor(item, events) {
    this.wrapper = createElement('div', { classList: ['timeline'] });
    this.itemBrackets = createElement('div');
    this.eventList = createElement('div', { classList: ['d-flex', 'flex-col'] });

    this.wrapper.appendChild(this.itemBrackets);
    this.wrapper.appendChild(this.eventList);

    for (const [src, srcTitle, srcID, title, time] of events) {
      // const style = { left: `${(time - firstTime) * zoom}px` };
      const titleText = src === item.shortname ? title : (
        title ? `${title} of ${srcTitle}` : srcTitle
      );
      this.eventList.appendChild(createElement('div', { classList: ['d-flex', 'gap-3'], children: [
        createElement('div', { classList: ['d-flex', 'justify-center'], style: { width: '0.5rem' }, children: [
          createElement('div', { classList: ['timeline-line'], children: [
            createElement('div', { classList: ['timeline-point'] }),
          ] }),
        ] }),
        createElement('div', { style: { paddingBottom: '1rem' }, children: [
          createElement('span', { attrs: { innerText: `${time} — ` }, children: [
            ...(src === item.shortname
            ? [createElement('span', { attrs: { innerText: title } })]
            : [
              ...(title ? [createElement('span', { attrs: { innerText: `${title} of ` } })] : []),
              createElement('a', {
                classList: ['link', 'link-animated'],
                attrs: { innerText: srcTitle, href: `/universes/${item.universe_short}/items/${src}` }
              }),
            ])
          ] }),
        ] }),
      ] }));
    }
  }
}

function renderTimeline(container, item, events) {
  const timeline = new Timeline(item, events);
  container.appendChild(timeline.wrapper);
  window.timeline = timeline;
  return timeline;
}