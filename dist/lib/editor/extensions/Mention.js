"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const suggestion_1 = require("@tiptap/suggestion");
const state_1 = require("@tiptap/pm/state");
const tippy_js_1 = __importDefault(require("tippy.js"));
const MentionPluginKey = new state_1.PluginKey('itemMentionSuggestion');
function renderSuggestionList() {
    let container;
    let popup;
    let items = [];
    let selectedIndex = 0;
    let command = () => { };
    function selectItem(index) {
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
        onStart: (props) => {
            items = props.items;
            command = props.command;
            container = document.createElement('div');
            container.className = 'options-container mention-suggestions';
            renderItems();
            popup = (0, tippy_js_1.default)('body', {
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
        onUpdate: (props) => {
            items = props.items;
            command = props.command;
            renderItems();
            popup[0].setProps({
                getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
            });
        },
        onKeyDown: ({ event }) => {
            if (!items.length)
                return false;
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
const Mention = core_1.Extension.create({
    name: 'itemMentionSuggestion',
    addOptions() {
        return {
            items: () => ({}),
            limit: 20,
        };
    },
    addProseMirrorPlugins() {
        return [
            (0, suggestion_1.Suggestion)({
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
exports.default = Mention;
