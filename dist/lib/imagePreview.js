"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePreview = generatePreview;
exports.previewToDataUri = previewToDataUri;
const sharp_1 = __importDefault(require("sharp"));
const logger_1 = __importDefault(require("../logger"));
const PREVIEW_WIDTH = 24;
const PREVIEW_JPEG_QUALITY = 40;
async function generatePreview(buffer) {
    try {
        return await (0, sharp_1.default)(buffer)
            .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
            .jpeg({ quality: PREVIEW_JPEG_QUALITY })
            .toBuffer();
    }
    catch (err) {
        logger_1.default.error(err);
        return null;
    }
}
function previewToDataUri(preview) {
    if (!preview)
        return null;
    return `data:image/jpeg;base64,${preview.toString('base64')}`;
}
