import { Extension } from '@tiptap/core';
import { Suggestion, SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import tippy, { Instance as TippyInstance, Props as TippyProps } from 'tippy.js';
import fuzzysort from 'fuzzysort';

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
  let popup: TippyInstance<TippyProps>[];
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
    items.forEach((item) => {
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

  return {
    onStart: (props: SuggestionProps<MentionItem>) => {
      items = props.items;
      command = props.command;

      container = document.createElement('div');
      container.className = 'options-container mention-suggestions';
      renderItems();

      popup = tippy('body', {
        getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
        appendTo: () => document.body,
        content: container,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
        arrow: false,
        offset: [0, 4],
      });
    },

    onUpdate: (props: SuggestionProps<MentionItem>) => {
      items = props.items;
      command = props.command;
      renderItems();
      popup[0].setProps({
        getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
      });
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

      return false;
    },

    onExit: () => {
      popup[0].destroy();
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
          const entries = Object.entries(source).map(([shortname, { title }]) => ({ shortname, title }));
          const q = query.trim();

          if (!q) {
            return entries.sort((a, b) => a.title.localeCompare(b.title)).slice(0, this.options.limit);
          }

          return fuzzysort.go(q, entries, { key: 'title', limit: this.options.limit }).map((result) => result.obj);
        },

        command: ({ editor, range, props }) => {
          const typed = editor.state.doc.textBetween(range.from + 1, range.to).trim();
          const label = typed || props.title;

          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'text', marks: [{ type: 'link', attrs: { href: `@${props.shortname}`, title: props.title } }], text: label },
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
