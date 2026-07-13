"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.editorExtensions = void 0;
exports.extractLinkData = extractLinkData;
exports.shorthandResolver = shorthandResolver;
const starter_kit_1 = __importDefault(require("@tiptap/starter-kit"));
const extension_text_align_1 = __importDefault(require("@tiptap/extension-text-align"));
const extension_collaboration_1 = __importDefault(require("@tiptap/extension-collaboration"));
const extension_collaboration_caret_1 = __importDefault(require("@tiptap/extension-collaboration-caret"));
const Aside_1 = __importDefault(require("./extensions/Aside"));
const Image_1 = __importDefault(require("./extensions/Image"));
const Link_1 = __importDefault(require("./extensions/Link"));
const ToC_1 = __importDefault(require("./extensions/ToC"));
const Heading_1 = __importDefault(require("./extensions/Heading"));
const IFrame_1 = __importDefault(require("./extensions/IFrame"));
const Mention_1 = __importDefault(require("./extensions/Mention"));
function extractLinkData(href) {
    const data = {};
    if (href.startsWith('@')) {
        let [first, second] = href.substring(1).split('/');
        if (first) {
            data.universe = first;
            if (!second) {
                second = first;
                delete data.universe;
            }
            const [itemQuery, hash] = second.split('#');
            const [item, query] = itemQuery.split('?');
            data.item = item;
            data.hash = hash;
            data.query = query;
        }
    }
    return data;
}
function shorthandResolver(href, ctx) {
    if (!href)
        return { href: '' };
    if (ctx) {
        if (href.startsWith('@')) {
            const { universe, item, hash, query } = extractLinkData(href);
            if (item) {
                const universeShort = universe ?? ctx.currentUniverse;
                if (!universeShort)
                    return { href };
                const universeLink = ctx.universeLink(universeShort);
                return {
                    href: `${universeLink}/items/${item}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`,
                    exists: ctx.itemExists(universeShort, item),
                };
            }
        }
    }
    return { href };
}
const editorExtensions = (editMode, context, collabOptions, imageExtension = Image_1.default) => {
    const extensions = [
        starter_kit_1.default.configure({
            link: false,
            heading: false,
            undoRedo: collabOptions ? false : undefined,
        }),
        Aside_1.default,
        Heading_1.default,
        imageExtension,
        IFrame_1.default,
        Link_1.default.configure({
            enableClickSelection: editMode,
            openOnClick: !editMode,
            shorthandResolver,
            context,
        }),
        ToC_1.default.configure({ context }),
        extension_text_align_1.default.configure({
            types: ['heading', 'paragraph'],
            defaultAlignment: 'left',
        }),
    ];
    if (editMode) {
        extensions.push(Mention_1.default.configure({
            items: () => context?.items?.() ?? {},
        }));
    }
    if (collabOptions) {
        const { ydoc, field, provider } = collabOptions;
        extensions.push(extension_collaboration_1.default.configure({
            document: ydoc,
            field,
        }));
        extensions.push(extension_collaboration_caret_1.default.configure({
            provider,
            selectionRender: (user) => {
                return {
                    nodeName: 'span',
                    class: 'collaboration-carets__selection',
                    style: `background-color: ${user.color}70`,
                    'data-user': user.name,
                };
            },
        }));
    }
    return extensions;
};
exports.editorExtensions = editorExtensions;
