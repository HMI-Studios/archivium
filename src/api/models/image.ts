import { API } from '..';
import { kysely } from '../../db/kysely';
import { NotFoundError } from '../../errors';
import { Image } from './item';
import { User } from './user';

export class ImageAPI {
  readonly api: API;

  constructor(api: API) {
    this.api = api;
  }

  async get(sessionUser: User | undefined, id: number): Promise<Image> {
    const image = await kysely
      .selectFrom('image')
      .leftJoin('userimage as ui', 'ui.image_id', 'image.id')
      .leftJoin('storyimage as si', 'si.image_id', 'image.id')
      .leftJoin('itemimage as ii', 'ii.image_id', 'image.id')
      .leftJoin('map', 'map.image_id', 'image.id')
      .select([
        'image.id', 'image.name', 'image.mimetype', 'image.data', 'image.preview',
        'map.item_id as map_item', 'ii.item_id', 'si.story_id', 'ui.user_id',
      ])
      .where('image.id', '=', id)
      .executeTakeFirst();
    if (!image) throw new NotFoundError();

    // Make sure we have access to this image
    const itemId = image.map_item ?? image.item_id;
    if (itemId) {
      await this.api.item.getOneBasic(sessionUser, { 'item.id': itemId });
    } else if (image.story_id) {
      await this.api.story.getOne(sessionUser, { 'story.id': image.story_id });
    } else if (image.user_id) {
      // User images as always visible
    }

    return image;
  }
}
