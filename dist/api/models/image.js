"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageAPI = void 0;
const utils_1 = require("../utils");
class ImageAPI {
    api;
    constructor(api) {
        this.api = api;
    }
    async get(sessionUser, id) {
        const queryString = `
      SELECT image.*, map.item_id AS map_item, ii.item_id, si.story_id, ui.user_id
      FROM image
      LEFT JOIN userimage ui ON ui.image_id = image.id
      LEFT JOIN storyimage si ON si.image_id = image.id
      LEFT JOIN itemimage ii ON ii.image_id = image.id
      LEFT JOIN map ON map.image_id = image.id
      WHERE image.id = ?
    `;
        const image = (await (0, utils_1.executeQuery)(queryString, [id]))[0];
        // Make sure we have access to this image
        const itemId = image.map_id ?? image.item_id;
        if (itemId) {
            await this.api.item.getOneBasic(sessionUser, { 'item.id': itemId });
        }
        else if (image.story_id) {
            await this.api.story.getOne(sessionUser, { 'story.id': image.story_id });
        }
        else if (image.user_id) {
            // User images as always visible
        }
        return image;
    }
}
exports.ImageAPI = ImageAPI;
