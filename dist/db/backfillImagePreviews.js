"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = __importDefault(require("."));
const utils_1 = require("../api/utils");
const imagePreview_1 = require("../lib/imagePreview");
async function main() {
    const rows = await (0, utils_1.executeQuery)('SELECT id FROM image WHERE preview IS NULL');
    console.log(`Found ${rows.length} images without a preview.`);
    for (let i = 0; i < rows.length; i++) {
        const { id } = rows[i];
        const [dataRows] = await _1.default.execute('SELECT data FROM image WHERE id = ?', [id]);
        const row = dataRows[0];
        if (!row)
            continue;
        const preview = await (0, imagePreview_1.generatePreview)(row.data);
        if (preview) {
            await _1.default.execute('UPDATE image SET preview = ? WHERE id = ?', [preview, id]);
        }
        console.log(`(${i + 1}/${rows.length}) image ${id}: ${preview ? 'generated' : 'skipped (unsupported format)'}`);
    }
    console.log('Done.');
    _1.default.end();
}
if (require.main === module) {
    main();
}
