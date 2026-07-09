"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const model_1 = require("@tiptap/pm/model");
const Heading_1 = require("./Heading");
function computeLiveTocData(doc) {
    const headings = [];
    const scopedByPos = new Map();
    const stack = [];
    function closeSectionsAtOrAbove(level) {
        while (stack.length && stack[stack.length - 1].level >= level) {
            const section = stack.pop();
            for (const pos of section.tocPositions) {
                scopedByPos.set(pos, section.headings);
            }
        }
    }
    doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
            const level = node.attrs.level ?? 1;
            const title = node.textContent;
            closeSectionsAtOrAbove(level);
            if (title) {
                headings.push({ title, level });
                for (const section of stack)
                    section.headings.push({ title, level });
            }
            stack.push({ level, headings: [], tocPositions: [] });
        }
        else if (node.type.name === 'toc' && stack.length > 0) {
            stack[stack.length - 1].tocPositions.push(pos);
        }
    });
    closeSectionsAtOrAbove(-Infinity);
    return { headings, scopedByPos };
}
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
    addNodeView() {
        const options = this.options;
        return ({ editor, getPos, HTMLAttributes }) => {
            const dom = document.createElement('div');
            const attrs = (0, core_1.mergeAttributes)(options.HTMLAttributes, HTMLAttributes);
            for (const [key, value] of Object.entries(attrs)) {
                if (value != null)
                    dom.setAttribute(key, String(value));
            }
            const heading = document.createElement('h3');
            heading.textContent = 'Table of Contents';
            dom.appendChild(heading);
            let listEl = null;
            const render = () => {
                const pos = getPos();
                if (pos === undefined)
                    return;
                const { headings, scopedByPos } = computeLiveTocData(editor.state.doc);
                const list = scopedByPos.get(pos) ?? headings;
                const rendered = model_1.DOMSerializer.renderSpec(document, generateToCDOM(list)).dom;
                if (listEl)
                    dom.replaceChild(rendered, listEl);
                else
                    dom.appendChild(rendered);
                listEl = rendered;
            };
            render();
            editor.on('update', render);
            return {
                dom,
                update: (updatedNode) => updatedNode.type.name === 'toc',
                destroy: () => editor.off('update', render),
            };
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
