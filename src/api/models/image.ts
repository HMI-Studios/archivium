import { API } from '..';
import { executeQuery } from '../utils';
import { Image } from './item';
import { User } from './user';

export class ImageAPI {
  readonly api: API;

  constructor(api: API) {
    this.api = api;
  }

  async get(sessionUser: User | undefined, id: number): Promise<Image> {
    const queryString = `
      SELECT image.*, map.item_id AS map_item, ii.item_id, si.story_id, ui.user_id
      FROM image
      LEFT JOIN userimage ui ON ui.image_id = image.id
      LEFT JOIN storyimage si ON si.image_id = image.id
      LEFT JOIN itemimage ii ON ii.image_id = image.id
      LEFT JOIN map ON map.image_id = image.id
      WHERE image.id = ?
    `;
    const image = (await executeQuery(queryString, [id]))[0];

    // Make sure we have access to this image
    const itemId = image.map_id ?? image.item_id;
    if (itemId) {
      await this.api.item.getOneBasic(sessionUser, { 'item.id': itemId });
    } else if (image.story_id) {
      await this.api.story.getOne(sessionUser, { 'story.id': image.story_id });
    } else if (image.user_id) {
      // User images as always visible
    }

    return image as Image;
  }
}
