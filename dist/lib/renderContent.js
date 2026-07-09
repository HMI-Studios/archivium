"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryRenderContent = tryRenderContent;
const html_string_1 = require("@tiptap/static-renderer/pm/html-string");
const sanitize_html_1 = __importDefault(require("sanitize-html"));
const api_1 = __importDefault(require("../api"));
const templates_1 = require("../templates");
const editor_1 = require("./editor");
const tiptapHelpers_1 = require("./tiptapHelpers");
const logger_1 = __importDefault(require("../logger"));
async function tryRenderContent(req, content, universeShortname) {
    try {
        const links = [];
        const headings = [];
        const jsonBody = (0, tiptapHelpers_1.indexedToJson)(content, (href) => links.push((0, editor_1.extractLinkData)(href)), (title, level) => headings.push({ title, level }));
        (0, tiptapHelpers_1.annotateTocScopes)(jsonBody);
        const itemsPerUniverse = {};
        /* Because Tiptap rendering cannot be async, we extract the links we'll need to check ahead of time. */
        await Promise.all(links.map(async (link) => {
            if (link.item) {
                const universeShort = link.universe ?? universeShortname;
                if (!universeShort)
                    return;
                if (!(universeShort in itemsPerUniverse)) {
                    itemsPerUniverse[universeShort] = {};
                }
                if (!(link.item in itemsPerUniverse[universeShort])) {
                    itemsPerUniverse[universeShort][link.item] = await api_1.default.item.exists(req.session.user, universeShort, link.item);
                }
            }
        }));
        const renderContext = {
            currentUniverse: universeShortname,
            universeLink: (universeShort) => (0, templates_1.universeLink)(req, universeShort),
            itemExists: (universe, item) => (universe in itemsPerUniverse) && itemsPerUniverse[universe][item],
            headings,
        };
        const htmlBody = (0, html_string_1.renderToHTMLString)({ extensions: (0, editor_1.editorExtensions)(false, renderContext), content: jsonBody });
        const sanitizedHtml = (0, sanitize_html_1.default)(htmlBody, {
            allowedTags: sanitize_html_1.default.defaults.allowedTags.concat(['img', 'iframe']),
            allowedAttributes: {
                ...sanitize_html_1.default.defaults.allowedAttributes,
                img: ['src', 'alt', 'title', 'width', 'height'],
                iframe: ['src'],
                h1: ['id', 'style'], h2: ['id', 'style'], h3: ['id', 'style'],
                h4: ['id', 'style'], h5: ['id', 'style'], h6: ['id', 'style'],
                p: ['style'],
            },
            disallowedTagsMode: 'escape',
            allowedClasses: {
                '*': false,
            },
        });
        return {
            type: 'html',
            content: sanitizedHtml,
        };
    }
    catch (err) {
        logger_1.default.error('Failed to parse content:');
        logger_1.default.error(err);
        return { type: 'text', content };
    }
}
