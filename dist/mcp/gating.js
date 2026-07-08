"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPremium = isPremium;
exports.itemsExposed = itemsExposed;
exports.notesExposed = notesExposed;
exports.discussionsExposed = discussionsExposed;
exports.mcpVisible = mcpVisible;
const utils_1 = require("../api/utils");
function isPremium(universe) {
    return universe.tier === utils_1.tiers.PREMIUM;
}
function itemsExposed(universe) {
    return isPremium(universe) && Boolean(universe.mcp_items_enabled);
}
function notesExposed(universe) {
    return isPremium(universe) && Boolean(universe.mcp_notes_enabled);
}
function discussionsExposed(universe) {
    return isPremium(universe) && Boolean(universe.mcp_discussions_enabled);
}
function mcpVisible(universe) {
    return itemsExposed(universe) || notesExposed(universe) || discussionsExposed(universe);
}
