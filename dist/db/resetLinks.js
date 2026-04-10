"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = __importDefault(require("."));
const api_1 = __importDefault(require("../api"));
const utils_1 = require("../api/utils");
const readline_1 = __importDefault(require("readline"));
async function main() {
    await (0, utils_1.executeQuery)('DELETE FROM itemlink');
    const items = await (0, utils_1.executeQuery)(`
    SELECT item.id, item.obj_data, universe.shortname as universe_short
    FROM item
    INNER JOIN universe ON universe.id = item.universe_id
  `);
    console.log(`Resetting links for ${items.length} items.`);
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        console.log(`Resetting... (${i}/${items.length})`);
        if (item.obj_data.body) {
            await api_1.default.item.handleLinks(item, item.obj_data);
        }
        readline_1.default.moveCursor(process.stdout, 0, -1);
    }
    console.log(`Resetting... (${items.length}/${items.length})`);
    _1.default.end();
}
if (require.main === module) {
    main();
}
