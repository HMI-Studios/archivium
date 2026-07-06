import { Extension } from '@tiptap/core';
import { Suggestion, SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';

export interface MentionItem {
  shortname: string;
  title: string;
}

export interface MentionOptions {
  items: () => Record<string, { title: string }>;
  limit: number;
}

const MentionPluginKey = new PluginKey('itemMentionSuggestion');

function renderSuggestionList() {
  let container: HTMLDivElement;
  let items: MentionItem[] = [];
  let selectedIndex = 0;
  let command: (item: MentionItem) => void = () => {};

  function selectItem(index: number) {
    selectedIndex = index;
    container.querySelectorAll('.option').forEach((el, i) => {
      el.classList.toggle('is-selected', i === selectedIndex);
    });
  }

  function renderItems() {
    container.innerHTML = '';
    items.forEach((item, i) => {
      const option = document.createElement('div');
      option.className = 'option';
      option.textContent = item.title;
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        command(item);
      });
      container.appendChild(option);
    });
    selectItem(0);
  }

  function updatePosition(clientRect: SuggestionProps<MentionItem>['clientRect']) {
    const rect = clientRect?.();
    if (!rect) return;
    container.style.top = `${rect.bottom + window.scrollY}px`;
    container.style.left = `${rect.left + window.scrollX}px`;
  }

  return {
    onStart: (props: SuggestionProps<MentionItem>) => {
      items = props.items;
      command = props.command;
      container = document.createElement('div');
      container.className = 'options-container mention-suggestions';
      document.body.appendChild(container);
      renderItems();
      updatePosition(props.clientRect);
    },

    onUpdate: (props: SuggestionProps<MentionItem>) => {
      items = props.items;
      command = props.command;
      renderItems();
      updatePosition(props.clientRect);
    },

    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (!items.length) return false;

      if (event.key === 'ArrowDown') {
        selectItem((selectedIndex + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        selectItem((selectedIndex - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        command(items[selectedIndex]);
        return true;
      }
      if (event.key === 'Escape') {
        container.remove();
        return true;
      }

      return false;
    },

    onExit: () => {
      container?.remove();
    },
  };
}

const Mention = Extension.create<MentionOptions>({
  name: 'itemMentionSuggestion',

  addOptions() {
    return {
      items: () => ({}),
      limit: 20,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<MentionItem>({
        editor: this.editor,
        char: '@',
        allowSpaces: true,
        pluginKey: MentionPluginKey,

        items: ({ query }) => {
          const source = this.options.items() ?? {};
          const q = query.trim().toLowerCase();

          return Object.entries(source)
            .filter(([, { title }]) => !q || title.toLowerCase().includes(q))
            .map(([shortname, { title }]) => ({ shortname, title }))
            .sort((a, b) => {
              const aStarts = a.title.toLowerCase().startsWith(q) ? 0 : 1;
              const bStarts = b.title.toLowerCase().startsWith(q) ? 0 : 1;
              return aStarts !== bStarts ? aStarts - bStarts : a.title.localeCompare(b.title);
            })
            .slice(0, this.options.limit);
        },

        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'text', marks: [{ type: 'link', attrs: { href: `@${props.shortname}` } }], text: props.title },
              { type: 'text', text: ' ' },
            ])
            .run();
        },

        render: renderSuggestionList,
      }),
    ];
  },
});

export default Mention;
