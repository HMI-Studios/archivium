if (!window.createElement) throw 'domUtils.js not loaded!';
if (!window.CalendarPicker) throw 'calendarPicker.js not loaded!';

class Timeline {
  constructor(item, events) {
    this.wrapper = createElement('div', { classList: ['timeline'] });
    this.itemBrackets = createElement('div');
    this.eventList = createElement('div', { classList: ['d-flex', 'flex-col'] });

    this.wrapper.appendChild(this.itemBrackets);
    this.wrapper.appendChild(this.eventList);
    const cp = new CalendarPicker();

    for (const { event_title, abstime, src_shortname, src_title } of events) {
      // const style = { left: `${(time - firstTime) * zoom}px` };
      cp.setTime(abstime);
      const formattedTime = cp.format();
      this.eventList.appendChild(createElement('div', { classList: ['d-flex', 'gap-3'], children: [
        createElement('div', { classList: ['d-flex', 'justify-center'], style: { width: '0.5rem' }, children: [
          createElement('div', { classList: ['timeline-line'], children: [
            createElement('div', { classList: ['timeline-point'] }),
          ] }),
        ] }),
        createElement('div', { style: { paddingBottom: '1rem' }, children: [
          createElement('span', { attrs: { innerText: `${formattedTime} — ` }, children: [
            ...(src_shortname === item.shortname
            ? [createElement('span', { attrs: { innerText: event_title || src_title } })]
            : [
              ...(event_title ? [createElement('span', { attrs: { innerText: `${event_title} of ` } })] : []),
              createElement('a', {
                classList: ['link', 'link-animated'],
                attrs: { innerText: src_title, href: `${universeLink(item.universe_short)}/items/${src_shortname}` }
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
