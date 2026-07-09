"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const Heading_1 = require("./Heading");
function generateToCDOM(headings) {
    if (!headings.length)
        return ['p', { style: 'margin-top: -1rem; margin-bottom: 0;' }, '. . .'];
    const root = ['ol', {}];
    let stack = [root];
    let currentLevel = headings[0].level;
    for (const { title, level } of headings) {
        while (currentLevel < level) {
            const newList = ['ol', {}];
            stack[stack.length - 1].push(newList);
            stack.push(newList);
            currentLevel++;
        }
        while (currentLevel > level && stack.length > 1) {
            stack.pop();
            currentLevel--;
        }
        stack[stack.length - 1].push(['li', { class: `toc-level-${level}` }, ['a', { class: 'link link-animated', href: `#${(0, Heading_1.slugify)(title)}` }, title]]);
    }
    return root;
}
const ToC = core_1.Node.create({
    name: 'toc',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addOptions() {
        return {
            HTMLAttributes: {
                class: 'toc',
            },
        };
    },
    parseHTML() {
        return [{ tag: 'div#toc' }];
    },
    addAttributes() {
        return {
            scopedHeadings: {
                default: null,
                rendered: false,
            },
        };
    },
    renderHTML({ node, HTMLAttributes }) {
        const headings = node.attrs.scopedHeadings ?? this.options.context?.headings;
        return [
            'div',
            (0, core_1.mergeAttributes)(this.options.HTMLAttributes, HTMLAttributes),
            ['h3', {}, 'Table of Contents'],
            ...(headings ? [generateToCDOM(headings)] : []),
        ];
    },
    addCommands() {
        return {
            insertToC: () => ({ commands }) => commands.insertContent({ type: this.name }),
        };
    },
    addInputRules() {
        return [
            (0, core_1.nodeInputRule)({
                find: /^@toc$/,
                type: this.type,
            }),
        ];
    },
});
exports.default = ToC;
