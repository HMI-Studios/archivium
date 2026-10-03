import sizeOf from 'buffer-image-size';
import { sql } from 'kysely';
import { kysely, Trx } from '../../db/kysely';
import { condToRawSql, toRawSql } from '../../db/legacyCond';
import api, { API } from '..';
import { ForbiddenError, InsufficientStorageError, ModelError, NotFoundError, UnauthorizedError, ValidationError } from '../../errors';
import { extractLinkData, LinkData } from '../../lib/editor';
import { generatePreview, previewToDataUri } from '../../lib/imagePreview';
import { IndexedDocument, indexedToJson, updateLinks } from '../../lib/tiptapHelpers';
import { BaseOptions, handleAsNull, parseData, perms, tierLimits, withTransaction } from '../utils';
import { User } from './user';
import { deepCompare } from '../../lib/utils';
import embedder from '../../embedding';

export type ItemOptions = BaseOptions & {
  type?: string,
  tag?: string,
  universe?: string,
  vault?: string,
  author?: string,
  includeData?: boolean,
};

export type EventOptions = BaseOptions & {
  title?: string | null,
};

export type Image = {
  id: number,
  name: string,
  mimetype: string,
  data?: Buffer,
  preview?: Buffer | null,
};

export type MapImage = Image & {
  item_id: number,
};

export type ItemImage = Image & {
  item_id: number,
  label: string,
  idx: number,
};

export type ItemEvent = {
  event_title: string | null,
  abstime: number | null,
  src_shortname: string,
  src_title: string,
  src_id: number,
};

export type GalleryImage = {
  id: number,
  name: string,
  label: string,
  preview?: string | null,
};

// TODO this typing is ugly...
export type Map = {
  id: number | null,
  width: number | null,
  height: number | null,
  image_id: number | null,
  preview?: string | null,
  locations: MapLocation[],
};

export type MapLocation = {
  id: number | null,
  title: string | null,
  universe: string | null,
  item: string | null,
  itemTitle: string | null,
  x: number,
  y: number,
};

export type Child = {
  child_shortname: string,
  child_title: string,
  child_label: string | null,
  parent_label: string | null,
};

export type Parent = {
  parent_shortname: string,
  parent_title: string,
  child_label: string | null,
  parent_label: string | null,
};

export type Family = {
  [shortname: string]: {
    title: string,
    parents: Parent[],
    children: Child[],
  },
};

export type ItemLink = {
  id: number,
  title: string,
  shortname: string,
  universe_short: string,
};

export type BuiltinTab = 'lineage' | 'map' | 'timeline' | 'gallery';

export type ObjData = {
  notes?: boolean,
  comments?: boolean,
  body?: IndexedDocument,
  tabs?: { [key: string]: any }, // TODO remove these any types at some point
  layoutTabs?: { [tabTypeId: string]: unknown },
} & { [K in BuiltinTab]?: any };

export type BasicItem = {
  id: number,
  title: string,
  shortname: string,
  item_type: string,
  created_at: Date,
  updated_at: Date,
  universe_id: number,
  vault_id: number | null,
  author: string | null,
  universe: string,
  universe_short: string,
  vault: string | null,
  vault_short: string | null,
  author_id: number | null,
  tags: string[],
  obj_data?: ObjData,
};

export type Item = BasicItem & {
  events: ItemEvent[],
  map: Map | null,
  gallery: GalleryImage[],
  parents: Parent[],
  children: Child[],
  links: ItemLink[],
  notifs_enabled: boolean,
};

class MapImageAPI {
  readonly item: ItemAPI;

  constructor(item: ItemAPI) {
    this.item = item;
  }

  async getOneByItemShort(user: User | undefined, universeShortname: string, itemShortname: string, options?): Promise<MapImage> {
    const item = await this.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.READ, true);
    return await this.getOneByItem(item, options);
  }

  async getMany(options: { [key: string]: any } | null): Promise<MapImage[]> {
    let query = kysely
      .selectFrom('map')
      .innerJoin('image', 'image.id', 'map.image_id')
      .select(['image.id', 'image.name', 'image.mimetype', 'image.data', 'map.item_id'])
      .where('map.image_id', 'is not', null);
    if (options) {
      for (const [key, value] of Object.entries(options)) {
        if (value === undefined) continue;
        query = query.where(kysely.dynamic.ref(key), '=', value);
      }
    }
    return await query.execute();
  }

  /**
   * The caller of this mehtod must ensure that the user has adequate permissions!
   */
  async getOneByItem(item: BasicItem, options?): Promise<MapImage> {
    const data = await this.getMany({ item_id: item.id, ...(options ?? {}) });
    const image = data[0];
    if (!image) throw new NotFoundError();
    return image;
  }

  async post(user: User | undefined, file: Express.Multer.File | undefined, universeShortname: string, itemShortname: string): Promise<{ insertId: number }> {
    if (!file) throw new ValidationError('Missing required fields');
    if (!user) throw new UnauthorizedError();

    const universe = await api.universe.getOne(user, { shortname: universeShortname });
    const totalStoredSize = await api.universe.getTotalStoredByShortname(universe.shortname);
    if (totalStoredSize + file.buffer.length > tierLimits[universe.tier ?? 0].images) {
      throw new InsufficientStorageError();
    }

    const { originalname, buffer, mimetype } = file;
    const { width, height } = sizeOf(buffer);
    const preview = await generatePreview(buffer);
    const item = await this.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.WRITE, true);
    const existingImage = await this.getOneByItem(item).catch(handleAsNull(NotFoundError));

    let data!: { insertId: number };
    await withTransaction(async (trx) => {
      // The map row may not exist yet if the client's autosave (which persists a newly added
      // map tab) hasn't landed before this upload request arrives, so create it on demand.
      let map = await trx.selectFrom('map').select('id').where('item_id', '=', item.id).executeTakeFirst();
      if (!map) {
        const inserted = await trx.insertInto('map').values({ item_id: item.id }).executeTakeFirstOrThrow();
        map = { id: Number(inserted.insertId ?? 0) };
      }

      const inserted = await trx
        .insertInto('image')
        .values({ name: originalname.substring(0, 64), mimetype, data: buffer, preview })
        .executeTakeFirstOrThrow();
      data = { insertId: Number(inserted.insertId ?? 0) };

      await trx.updateTable('map').set({ image_id: data.insertId, width, height }).where('id', '=', map.id).execute();

      if (existingImage) {
        await trx.deleteFrom('image').where('id', '=', existingImage.id).execute();
      }
    });

    return data;
  }

  async del(user: User | undefined, imageId: number, conn?: Trx): Promise<void> {
    if (!user) throw new UnauthorizedError();
    const images = await this.getMany({ 'image.id': imageId });
    const image = images && images[0];
    if (!image) throw new NotFoundError();
    await this.item.getOne(user, { 'item.id': image.item_id }, perms.WRITE); // we need to get the item here to make sure it exists
    const doDelete = async (conn: Trx) => {
      await conn.updateTable('map').set({ image_id: null }).where('image_id', '=', imageId).execute();
      await conn.deleteFrom('image').where('id', '=', imageId).execute();
    };
    if (conn) {
      await doDelete(conn);
    } else {
      await withTransaction(doDelete);
    }
  }
}

class ItemImageAPI {
  readonly item: ItemAPI;

  constructor(item: ItemAPI) {
    this.item = item;
  }

  async getOneByItemShort(user: User | undefined, universeShortname: string, itemShortname: string, options?): Promise<ItemImage> {
    const item = await this.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.READ, true);
    const data = await this.getMany({ item_id: item.id, ...(options ?? {}) });
    const image = data[0];
    if (!image) throw new NotFoundError();
    return image;
  }

  async getMany(options: { [key: string]: any } | null, inclData = true): Promise<ItemImage[]> {
    let query = kysely
      .selectFrom('itemimage')
      .innerJoin('image', 'image.id', 'itemimage.image_id')
      .select(['image.id', 'itemimage.item_id', 'image.name', 'image.mimetype', 'itemimage.label', 'itemimage.idx'])
      .$if(inclData, (qb) => qb.select('image.data'));
    if (options) {
      for (const [key, value] of Object.entries(options)) {
        if (value === undefined) continue;
        query = query.where(kysely.dynamic.ref(key), '=', value);
      }
    }
    return await query.orderBy('itemimage.idx').execute();
  }

  async getManyByItemShort(user: User | undefined, universeShortname: string, itemShortname: string, options?: ItemOptions, inclData = false): Promise<ItemImage[]> {
    const item = await this.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.READ, true);
    const images = await this.getMany({ item_id: item.id, ...(options ?? {}) }, inclData) as ItemImage[];
    return images;
  }

  async post(user: User | undefined, file: Express.Multer.File | undefined, universeShortname: string, itemShortname: string): Promise<{ insertId: number }> {
    if (!file) throw new ValidationError('Missing required fields');
    if (!user) throw new UnauthorizedError();

    const universe = await api.universe.getOne(user, { shortname: universeShortname });
    const totalStoredSize = await api.universe.getTotalStoredByShortname(universe.shortname);
    if (totalStoredSize + file.buffer.length > tierLimits[universe.tier ?? 0].images) {
      throw new InsufficientStorageError();
    }

    const { originalname, buffer, mimetype } = file;
    const preview = await generatePreview(buffer);
    const item = await this.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.WRITE, true);

    let data!: { insertId: number };
    await withTransaction(async (trx) => {
      const inserted = await trx
        .insertInto('image')
        .values({ name: originalname.substring(0, 64), mimetype, data: buffer, preview })
        .executeTakeFirstOrThrow();
      data = { insertId: Number(inserted.insertId ?? 0) };

      await trx
        .insertInto('itemimage')
        .values({ item_id: item.id, image_id: data.insertId, label: '', idx: 0 })
        .execute();
    });
    return data;
  }

  async putLabel(user: User | undefined, imageId: number, label: string, conn?: Trx): Promise<{ numUpdatedRows: number }> {
    if (!user) throw new UnauthorizedError();
    const images = await this.getMany({ id: imageId }, false) as ItemImage[];
    const image = images && images[0];
    if (!image) throw new NotFoundError();
    await this.item.getOne(user, { 'item.id': image.item_id }); // we need to get the item here to make sure it exists
    const result = await (conn ?? kysely).updateTable('itemimage').set({ label }).where('image_id', '=', imageId).executeTakeFirstOrThrow();
    return { numUpdatedRows: Number(result.numUpdatedRows) };
  }

  async putIdx(user: User | undefined, imageId: number, idx: number, conn?: Trx): Promise<{ numUpdatedRows: number }> {
    if (!user) throw new UnauthorizedError();
    const images = await this.getMany({ id: imageId }, false) as ItemImage[];
    const image = images && images[0];
    if (!image) throw new NotFoundError();
    await this.item.getOne(user, { 'item.id': image.item_id }); // we need to get the item here to make sure it exists
    const result = await (conn ?? kysely).updateTable('itemimage').set({ idx }).where('image_id', '=', imageId).executeTakeFirstOrThrow();
    return { numUpdatedRows: Number(result.numUpdatedRows) };
  }

  async del(user: User | undefined, imageId: number, conn?: Trx): Promise<void> {
    if (!user) throw new UnauthorizedError();
    const images = await this.getMany({ id: imageId }, false) as ItemImage[];
    const image = images && images[0];
    if (!image) throw new NotFoundError();
    await this.item.getOne(user, { 'item.id': image.item_id }, perms.WRITE); // we need to get the item here to make sure it exists
    await (conn ?? kysely).deleteFrom('image').where('id', '=', imageId).execute(); // itemimage will be deleted by cascade
  }
}

export class ItemAPI {
  readonly image: ItemImageAPI;
  readonly mapImage: MapImageAPI;
  readonly api: API;

  constructor(api: API) {
    this.image = new ItemImageAPI(this);
    this.mapImage = new MapImageAPI(this);
    this.api = api;
  }

  async getOneBasic(user: User | undefined, conditions: any={}, permissionsRequired=perms.READ, options: ItemOptions = {}): Promise<BasicItem> {
    const parsedConditions = parseData(conditions);

    const data = await this.getMany(user, parsedConditions, permissionsRequired, { ...options, limit: 1 });
    const item = data[0];
    if (!item) {
      if (user) throw new ForbiddenError();
      else throw new UnauthorizedError();
    }

    return item;
  }

  async getOne(user: User | undefined, conditions: any = {}, permissionsRequired = perms.READ, options: ItemOptions = {}): Promise<Item> {
    const item: Item = {
      ...await this.getOneBasic(user, conditions, permissionsRequired, options),
      events: [],
      map: null,
      gallery: [],
      parents: [],
      children: [],
      links: [],
      notifs_enabled: false,
    };

    const events = await kysely
      .selectFrom('itemevent')
      .leftJoin('timelineitem', 'timelineitem.event_id', 'itemevent.id')
      .innerJoin('item', 'item.id', 'itemevent.item_id')
      .distinct()
      .select([
        'itemevent.event_title', 'itemevent.abstime',
        'item.shortname as src_shortname', 'item.title as src_title', 'item.id as src_id',
      ])
      .where((eb) => eb.or([
        eb('itemevent.item_id', '=', item.id),
        eb('timelineitem.timeline_id', '=', item.id),
      ]))
      .orderBy('itemevent.abstime', 'desc')
      .execute();
    item.events = events;

    const map = await kysely
      .selectFrom('map')
      .leftJoin('image as mapimage', 'mapimage.id', 'map.image_id')
      .leftJoin('maplocation as loc', 'loc.map_id', 'map.id')
      .leftJoin('item as locitem', 'locitem.id', 'loc.item_id')
      .leftJoin('universe as locuniverse', 'locuniverse.id', 'locitem.universe_id')
      .select(['map.id', 'map.width', 'map.height', 'map.image_id', 'mapimage.preview'])
      .select(sql<MapLocation[]>`
        JSON_ARRAYAGG(JSON_OBJECT(
          'id', loc.id,
          'title', loc.title,
          'universe', locuniverse.shortname,
          'item', locitem.shortname,
          'itemTitle', locitem.title,
          'x', loc.x,
          'y', loc.y
        ))
      `.as('locations'))
      .where('map.item_id', '=', item.id)
      .groupBy('map.id')
      .executeTakeFirst() ?? null;
    if (map?.locations.length === 1 && map.locations[0].id === null) {
      map.locations = [];
    }
    item.map = map ? { ...map, preview: previewToDataUri(map.preview) } : null;

    const gallery = await kysely
      .selectFrom('itemimage')
      .innerJoin('image', 'image.id', 'itemimage.image_id')
      .select(['image.id', 'image.name', 'itemimage.label', 'image.preview'])
      .where('itemimage.item_id', '=', item.id)
      .orderBy('itemimage.idx')
      .execute();
    item.gallery = gallery.map((img) => ({ ...img, preview: previewToDataUri(img.preview) }));

    [item.parents, item.children] = await this.getLineage(item);

    const links = await kysely
      .selectFrom('itemlink')
      .innerJoin('item as li', 'li.id', 'itemlink.from_item')
      .innerJoin('universe as lu', 'lu.id', 'li.universe_id')
      .distinct()
      .select(['li.id', 'li.shortname', 'li.title', 'lu.shortname as universe_short'])
      .where('itemlink.to_universe_short', '=', item.universe_short)
      .where('itemlink.to_item_short', '=', item.shortname)
      .execute();
    item.links = links;

    if (item.obj_data) {
      const links = await kysely
        .selectFrom('itemlink')
        .select(['to_universe_short', 'to_item_short', 'href'])
        .where('from_item', '=', item.id)
        .execute();
      if (item.obj_data.body) {
        const linkMap = {};
        for (const { to_universe_short, to_item_short, href } of links) {
          linkMap[href] = [to_universe_short, to_item_short];
        }
        updateLinks(item.obj_data.body, (href) => {
          if (href in linkMap) {
            const linkData = extractLinkData(href);
            if (linkData.item) {
              const [toUniverse, toItem] = linkMap[href];
              if (toUniverse === item.universe_short) {
                return href.replace(linkData.item, toItem);
              } else if (linkData.universe) {
                return href.replace(linkData.universe, toUniverse).replace(linkData.item, toItem);
              } else {
                return `@${toUniverse}/${toItem}${linkData.query ? `?${linkData.query}` : ''}${linkData.hash ? `#${linkData.hash}` : ''}`;
              }
            }
          }

          return href;
        });
      }
    }

    if (user) {
      const notif = await kysely
        .selectFrom('itemnotification')
        .select(sql<number>`1`.as('one'))
        .where('item_id', '=', item.id)
        .where('user_id', '=', user.id)
        .where('is_enabled', '=', true)
        .executeTakeFirst();
      item.notifs_enabled = notif !== undefined;
    }

    return item;
  }

  async getMany(user: User | undefined, conditions, permissionsRequired = perms.READ, options: ItemOptions = {}): Promise<BasicItem[]> {
    if (options.sort && !options.forceSort) {
      const validSorts = { 'title': true, 'created_at': true, 'updated_at': true, 'author': true, 'item_type': true };
      if (!validSorts[options.sort]) {
        delete options.sort;
      }
    }

    if (!user && permissionsRequired > perms.READ) throw new ValidationError('User is required to access at above read-only permissions.');

    let query = kysely
      .selectFrom('item')
      .leftJoin('user', 'user.id', 'item.author_id')
      .innerJoin('universe', 'universe.id', 'item.universe_id')
      .leftJoin('vault', 'vault.id', 'item.vault_id')
      .leftJoin('authoruniverse as au_filter', (join) => join
        .onRef('universe.id', '=', 'au_filter.universe_id')
        .on('au_filter.user_id', '=', user?.id ?? -1))
      .leftJoin('vaultauthor as va_filter', (join) => join
        .onRef('vault.id', '=', 'va_filter.vault_id')
        .on('va_filter.user_id', '=', user?.id ?? -1))
      .leftJoin(
        (eb) => eb
          .selectFrom('tag')
          .select((eb2) => [eb2.fn<string>('JSON_ARRAYAGG', [eb2.ref('tag.tag')]).as('tags')])
          .select('tag.item_id')
          .groupBy('tag.item_id')
          .as('tag_agg'),
        (join) => join.onRef('tag_agg.item_id', '=', 'item.id'),
      )
      .select([
        'item.id',
        'item.title',
        'item.shortname',
        'item.item_type',
        'item.created_at',
        'item.updated_at',
        'item.universe_id',
        'item.vault_id',
        'item.author_id',
        'user.username as author',
        'universe.title as universe',
        'universe.shortname as universe_short',
        'vault.title as vault',
        'vault.shortname as vault_short',
      ])
      .select(sql<string[]>`IFNULL(tag_agg.tags, JSON_ARRAY())`.as('tags'))

      // at least one of these OR branches is always applicable by the time we get here
      .where((eb) => eb.or([
        ...(permissionsRequired <= perms.READ ? [eb.and([
          eb('item.vault_id', 'is', null),
          eb('universe.is_public', '=', true),
        ])] : []),
        ...(user ? [
          eb.and([eb('item.vault_id', 'is', null), eb('au_filter.permission_level', '>=', permissionsRequired)]),
          eb.and([eb('item.vault_id', 'is not', null), eb('va_filter.permission_level', '>=', permissionsRequired)]),
          eb.and([eb('item.vault_id', 'is not', null), eb('au_filter.permission_level', '>=', perms.OWNER)]),
        ] : []),
      ]))

      .groupBy(['item.id', 'user.username', 'universe.title'])
      .$if(options.type !== undefined && options.type !== '', (qb) => qb.where('item.item_type', '=', options.type!))
      .$if(options.tag !== undefined && options.tag !== '', (qb) => qb.where((eb) => eb.exists(
        eb.selectFrom('tag as tag_filter')
          .select('tag_filter.item_id')
          .whereRef('tag_filter.item_id', '=', 'item.id')
          .where('tag_filter.tag', '=', options.tag!),
      )))
      .$if(options.universe !== undefined && options.universe !== '', (qb) => qb.where('universe.shortname', '=', options.universe!))
      .$if(options.vault !== undefined && options.vault !== '', (qb) => qb.where('vault.shortname', '=', options.vault!))
      .$if(options.author !== undefined && options.author !== '', (qb) => qb.where('user.username', '=', options.author!))
      .$if(options.includeData === true, (qb) => qb.select('item.obj_data'))
      .$if(options.search !== undefined && options.search !== '', (qb) => {
        const search = options.search!;
        const textExpr = sql<string | null>`CAST(JSON_UNQUOTE(JSON_EXTRACT(item.obj_data, '$.body.text')) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_general_ci`;
        return qb
          .leftJoin('tag as search_tag', (join) => join.onRef('search_tag.item_id', '=', 'item.id'))
          .where((eb) => eb.or([
            eb('item.title', 'like', `%${search}%`),
            eb('item.shortname', 'like', `%${search}%`),
            eb('search_tag.tag', '=', search),
            eb('search_tag.tag', 'like', `%${search}%`),
            sql<boolean>`${textExpr} LIKE ${`%${search}%`}`,
          ]))
          .select(sql<number>`LOCATE(${search}, ${textExpr})`.as('match_pos'))
          .select(sql<string | null>`
            CASE
              WHEN LOCATE(${search}, ${textExpr}) > 0
              THEN SUBSTRING(${textExpr}, GREATEST(1, LOCATE(${search}, ${textExpr}) - 50), 100)
              ELSE NULL
            END
          `.as('snippet'));
      });


    // TODO even more condition hacking we want to get rid of
    let bridged: any = query;
    if (conditions) {
      for (let i = 0; i < conditions.strings.length; i++) {
        bridged = bridged.where(toRawSql<boolean>(conditions.strings[i], [conditions.values[i]]));
      }
    }
    if (options.where) {
      const raw = condToRawSql(options.where);
      if (raw) bridged = bridged.where(raw);
    }
    for (const [joinType, table, onCond] of options.join ?? []) {
      const tableExpr = Array.isArray(table) ? `${table[0]} as ${table[1]}` : table;
      const method = joinType === 'INNER' ? 'innerJoin' : joinType === 'LEFT' ? 'leftJoin' : 'rightJoin';
      const raw = condToRawSql(onCond);
      bridged = bridged[method](tableExpr, (join: any) => (raw ? join.on(raw) : join));
    }
    for (const [col, alias, value] of options.select ?? []) {
      if (!alias) continue;
      const values = value === undefined ? [] : (Array.isArray(value) ? value : [value]);
      bridged = bridged.select(toRawSql(col, values).as(alias));
    }
    if (options.groupBy?.length) {
      bridged = bridged.groupBy(options.groupBy.map((col) => kysely.dynamic.ref(col)));
    }
    query = bridged as typeof query;


    query = options.sort
      ? query.orderBy(
        options.forceSort ? sql.raw(options.sort) : kysely.dynamic.ref(options.sort),
        options.sortDesc ? 'desc' : 'asc',
      )
      : query.orderBy('item.updated_at', 'desc');
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const data = await query.execute();

    return data;
  }

  async getByAuthorUsername(user, username, permissionsRequired, options): Promise<BasicItem[]> {

    const conditions = {
      strings: [
        'user.username = ?',
      ], values: [
        username,
      ]
    };

    const items = await this.getMany(user, conditions, permissionsRequired, options);
    return items;
  }

  async getByUniverseId(user, universeId, permissionsRequired, options): Promise<BasicItem[]> {

    const conditions = {
      strings: [
        'item.universe_id = ?',
      ], values: [
        universeId,
      ]
    };

    const items = await this.getMany(user, conditions, permissionsRequired, options);
    return items;
  }

  async getByUniverseAndItemIds(user, universeId, itemId, permissionsRequired = perms.READ): Promise<BasicItem> {

    const conditions = {
      strings: [
        'item.universe_id = ?',
        'item.id = ?',
      ], values: [
        universeId,
        itemId,
      ]
    };

    const data = await this.getMany(user, conditions, permissionsRequired);
    const item = data[0];
    if (!item) {
      if (user) throw new ForbiddenError();
      else throw new UnauthorizedError();
    }
    return item;
  }

  async getByUniverseShortname(user: User | undefined, shortname: string, permissionsRequired = perms.READ, options?: ItemOptions): Promise<BasicItem[]> {

    const conditions = {
      strings: [
        'universe.shortname = ?',
      ], values: [
        shortname,
      ]
    };

    const items = await this.getMany(user, conditions, permissionsRequired, options);
    return items;
  }

  // TODO if we decide not to premium-gate custom tabs, this will no longer be needed
  async getLayoutTabUsage(universeId: number): Promise<{ [tabTypeId: string]: number }> {
    // TODO JSON_TABLE has no Kysely equivalent - can we use something else?
    const { rows } = await sql<{ id: string, count: number }>`
      SELECT tab.id, COUNT(*) AS count
      FROM item,
      JSON_TABLE(JSON_KEYS(item.obj_data, '$.layoutTabs'), '$[*]' COLUMNS (id VARCHAR(255) PATH '$')) AS tab
      WHERE item.universe_id = ${universeId}
      GROUP BY tab.id
    `.execute(kysely);
    return rows.reduce((acc, { id, count }) => ({ ...acc, [id]: Number(count) }), {});
  }

  async getByUniverseAndItemShortnames(
    user: User | undefined,
    universeShortname: string,
    itemShortname: string,
    permissionsRequired = perms.READ,
    basicOnly = false,
    includeData = true
  ): Promise<Item | BasicItem> {

    const conditions = {
      'universe.shortname': universeShortname,
      'item.shortname': itemShortname,
    };

    if (basicOnly) return await this.getOneBasic(user, conditions, permissionsRequired, { includeData });
    else return await this.getOne(user, conditions, permissionsRequired, { includeData });
  }

  /**
   *
   * @param {*} user
   * @param {*} universe
   * @param {*} validate
   * @returns {Promise<[number, QueryResult]>}
   */
  async getCountsByUniverse(user, universe, validate = true): Promise<[{ [type: string]: number }, number]> {
    if (!universe.is_public && validate) {
      if (!user) throw new UnauthorizedError();
      if (!(universe.author_permissions[user.id] >= perms.READ)) throw new ForbiddenError();
    }

    const data = await kysely
      .selectFrom('item')
      .select('item_type')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('universe_id', '=', universe.id)
      .groupBy('item_type')
      .execute();
    const counts = {};
    let total = 0;
    for (const row of data) {
      counts[row.item_type] = row.count;
      total += row.count;
    }
    return [counts, total];
  }

  async forEachUserToNotify(item, callback): Promise<void> {
    const targetIDs = (await kysely
      .selectFrom('itemnotification')
      .select('user_id')
      .where('item_id', '=', item.id)
      .where('is_enabled', '=', true)
      .execute()).map(row => row.user_id);
    for (const userID of targetIDs) {
      const user = await this.api.user.getOne({ 'user.id': userID });
      await callback(user);
    }
  }

  async post(user: User | undefined, body, universeShortName: string): Promise<{ insertId: number }> {
    if (!user) throw new UnauthorizedError();
    const { title, shortname, item_type, parent_id, obj_data, skipValidation, vault: vaultShortname } = body;

    try {
      if (!skipValidation) {
        const shortnameError = this.api.universe.validateShortname(shortname);
        if (shortnameError) throw new ValidationError(shortnameError);
      }

      const universe = await this.api.universe.getOne(user, { 'universe.shortname': universeShortName }, skipValidation ? perms.ADMIN : perms.WRITE);
      if (!title || !shortname || !item_type || !obj_data) throw new ValidationError('Missing required fields');

      const vault = vaultShortname
        ? await this.api.vault.getOne(user, { strings: ['vault.shortname = ?', 'vault.universe_id = ?'], values: [vaultShortname, universe.id] }, perms.WRITE)
        : null;

      let insertId: number | undefined;
      await withTransaction(async (trx) => {
        const result = await trx
          .insertInto('item')
          .values({
            title,
            shortname,
            item_type,
            author_id: user.id,
            universe_id: universe.id,
            parent_id: parent_id ?? null,
            // TODO long term we want to only deal in JSON here, not strings
            obj_data: typeof obj_data === 'string' ? obj_data : JSON.stringify(obj_data),
            created_at: new Date(),
            updated_at: new Date(),
            vault_id: vault?.id ?? null,
          })
          .executeTakeFirstOrThrow();
        insertId = Number(result.insertId);

        await trx
          .insertInto('itemnotification')
          .values({ item_id: insertId, user_id: user.id, is_enabled: true })
          .execute();

        this.api.universe.putUpdatedAtWithTransaction(trx, universe.id, new Date());
      });

      if (insertId === undefined) {
        throw new ModelError('Failed to insert item');
      }

      if (universe.obj_data.semanticSearchEnabled) {
        embedder.addJob({ type: 'check', itemId: insertId });
      }

      return { insertId };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ValidationError(`Shortname "${shortname}" already in use in this universe, please choose another.`);
      throw err;
    }
  }

  async save(user: User | undefined, universeShortname: string, itemShortname: string, body: Partial<Item>): Promise<number> {
    let item!: Item;
    await withTransaction(async (trx) => {
      // Actually save item
      const changes = {
        title: body.title,
        shortname: body.shortname,
        item_type: body.item_type,
        obj_data: body.obj_data,
        tags: body.tags ?? [],
        vault_short: body.vault_short,
      };
      const itemId = await this.put(user, universeShortname, itemShortname, changes, trx);

      item = await this.getOne(user, { 'item.id': itemId }, perms.WRITE);

      let dataChanged = false;

      // Handle lineage data
      if (body.parents || body.children) {
        const existingParents: { [key: string]: Parent } = {};
        const existingChildren: { [key: string]: Child } = {};
        for (const parent of item.parents) existingParents[parent.parent_shortname] = parent;
        for (const child of item.children) existingChildren[child.child_shortname] = child;
        const [newParents, newChildren] = [{}, {}];
        for (const { parent_shortname, parent_label, child_label } of body.parents ?? []) {
          const parent = await this.getByUniverseAndItemShortnames(user, universeShortname, parent_shortname, perms.WRITE).catch(handleAsNull([NotFoundError, ForbiddenError]));
          if (!parent) continue;
          newParents[parent_shortname] = true;
          if (
            !(parent_shortname in existingParents)
            || existingParents[parent_shortname].parent_label !== parent_label
            || existingParents[parent_shortname].child_label !== child_label
          ) {
            dataChanged = true;
            await this.putLineage(parent.id, item.id, parent_label ?? null, child_label ?? null, trx);
          }
        }
        for (const { child_shortname, parent_label, child_label } of body.children ?? []) {
          const child = await this.getByUniverseAndItemShortnames(user, universeShortname, child_shortname, perms.WRITE).catch(handleAsNull([NotFoundError, ForbiddenError]));
          if (!child) continue;
          newChildren[child_shortname] = true;
          if (
            !(child_shortname in existingChildren)
            || existingChildren[child_shortname].parent_label !== parent_label
            || existingChildren[child_shortname].child_label !== child_label
          ) {
            dataChanged = true;
            await this.putLineage(item.id, child.id, parent_label ?? null, child_label ?? null, trx);
          }
        }
        for (const { parent_shortname } of item.parents) {
          if (!newParents[parent_shortname]) {
            const parent = await this.getByUniverseAndItemShortnames(user, universeShortname, parent_shortname, perms.WRITE);
            dataChanged = true;
            await this.delLineage(parent.id, item.id, trx);
          }
        }
        for (const { child_shortname } of item.children) {
          if (!newChildren[child_shortname]) {
            const child = await this.getByUniverseAndItemShortnames(user, universeShortname, child_shortname, perms.WRITE);
            dataChanged = true;
            await this.delLineage(item.id, child.id, trx);
          }
        }
      }

      // Handle timeline data
      if (body.events) {
        const myEvents = body.events?.filter(event => event.src_id === item.id);
        const myImports = body.events?.filter(event => event.src_id !== item.id);
        if (myEvents) {
          const events = await this.fetchEvents(item.id);
          const existingEvents = new Map(events.map((event) => [event.event_title, event]));
          const newEvents = myEvents.filter(event => !existingEvents.has(event.event_title));
          const updatedEvents = myEvents.filter(event => {
            const existing = existingEvents.get(event.event_title);
            return existing && (existing.event_title !== event.event_title || existing.abstime !== event.abstime);
          }).map(({ event_title, abstime }) => ({ event_title, abstime, id: existingEvents.get(event_title)!.id }));
          const newEventTitles = new Set(myEvents.map(event => event.event_title));
          const deletedEvents = events.filter(event => !newEventTitles.has(event.event_title)).map(event => event.id);
          await this.insertEvents(item.id, newEvents, trx);
          for (const event of updatedEvents) {
            await this.updateEvent(event.id, event, trx);
          }
          await this.deleteEvents(deletedEvents, trx);
          if (newEvents.length > 0 || updatedEvents.length > 0 || deletedEvents.length > 0) {
            dataChanged = true;
          }
        }

        if (myImports) {
          const imports = await this.fetchImports(item.id);
          const existingImports = imports.reduce((acc, ti) => ({ ...acc, [ti.event_id]: ti }), {});
          const newImports: number[] = [];
          const importsMap = {};
          for (const { src_id: itemId, event_title: eventTitle } of myImports) {
            const event = (await this.fetchEvents(itemId, { title: eventTitle }))[0];
            if (!event) continue;
            if (!(event.id in existingImports)) {
              newImports.push(event.id);
            }
            importsMap[event.id] = true;
          }
          const deletedImports = imports.filter(ti => !importsMap[ti.event_id]).map(ti => ti.event_id);
          await this.importEvents(item.id, newImports, trx);
          await this.deleteImports(item.id, deletedImports, trx);
          if (newImports.length > 0 || deletedImports.length > 0) {
            dataChanged = true;
          }
        }
      }

      // Handle gallery data
      if (body.gallery) {
        const existingImages = await this.image.getManyByItemShort(user, universeShortname, item.shortname);
        const oldImages = {};
        const newImages = {};
        for (const img of existingImages ?? []) {
          oldImages[img.id] = img;
        }
        await Promise.all((body.gallery ?? []).map(async (img, i) => {
          newImages[img.id] = img;
          if (img.label !== undefined && oldImages[img.id] && img.label !== oldImages[img.id].label) {
            dataChanged = true;
            await this.image.putLabel(user, img.id, img.label, trx);
          }
          if (oldImages[img.id] && i !== oldImages[img.id].idx) {
            dataChanged = true;
            await this.image.putIdx(user, img.id, i, trx);
          }
        }));
        for (const img of existingImages ?? []) {
          if (!newImages[img.id]) {
            dataChanged = true;
            await this.image.del(user, img.id, trx);
          }
        }
      }

      // Handle map data
      if (body.map) {
        dataChanged = true;
        let mapId: number;
        if (body.map.id === null) {
          dataChanged = true;
          mapId = await this.insertMap(item.id, body.map, trx);
        } else {
          mapId = body.map.id;
        }

        // TODO: bunch of typing nonsense here too
        const existingLocations = (await this.fetchLocations(mapId)).reduce((acc, loc) => ({ ...acc, [loc.id!]: loc }), {});
        const updatedLocations = body.map.locations.filter(loc => loc.id && existingLocations[loc.id] && (
          existingLocations[loc.id].x !== loc.x
          || existingLocations[loc.id].y !== loc.y
          || existingLocations[loc.id].universe !== loc.universe
          || existingLocations[loc.id].item !== loc.item
        ));
        const newLocations = body.map.locations.filter(loc => loc.id === null || !(loc.id in existingLocations));
        const deletedLocations = body.map.locations.reduce((locations, loc) => {
          if (loc.id && loc.id in locations) delete locations[loc.id];
          return locations;
        }, { ...existingLocations });
        for (const loc of newLocations) {
          const targetItem = (loc.item && loc.universe) 
            ? await this.getByUniverseAndItemShortnames(user, loc.universe, loc.item, perms.READ, true)
            : null;
          await this.insertLocation(mapId, loc, targetItem?.id ?? null, trx);
        }
        for (const loc of updatedLocations) {
          let targetItemId: number | null | undefined = undefined;
          if (loc.item !== existingLocations[loc.id!].item || loc.universe !== existingLocations[loc.id!].universe) {
            if (loc.item && loc.universe) {
              const targetItem = await this.getByUniverseAndItemShortnames(user, loc.universe, loc.item, perms.READ, true);
              targetItemId = targetItem.id;
            } else {
              targetItemId = null;
            }
          }
          await this.updateLocation(loc, targetItemId, trx);
        }
        for (const locId in deletedLocations) {
          await this.deleteLocation(Number(locId));
        }
        if (newLocations.length > 0 || updatedLocations.length > 0 || Object.keys(deletedLocations).length > 0) {
          dataChanged = true;
        }
      }

      if (dataChanged) {
        this.markUpdated(item.id, trx);
      }
    });

    const universe = await this.api.universe.getOne(user, { 'universe.shortname': universeShortname });
    if (universe.obj_data.semanticSearchEnabled) {
      embedder.addJob({
        type: 'check',
        itemId: item.id,
      });
    }

    return item.id;
  }

  async insertMap(itemId: number, map: Map, conn?: Trx): Promise<number> {
    const inserted = await (conn ?? kysely)
      .insertInto('map')
      .values({ width: map.width, height: map.height, image_id: map.image_id ?? null, item_id: itemId })
      .executeTakeFirstOrThrow();
    return Number(inserted.insertId ?? 0);
  }
  async fetchLocations(mapId: number): Promise<MapLocation[]> {
    const rows = await kysely
      .selectFrom('maplocation')
      .leftJoin('item as locitem', 'locitem.id', 'maplocation.item_id')
      .leftJoin('universe as locuniverse', 'locuniverse.id', 'locitem.universe_id')
      .select([
        'maplocation.id', 'maplocation.title', 'maplocation.x', 'maplocation.y',
        'locuniverse.shortname as universe', 'locitem.shortname as item', 'locitem.title as itemTitle',
      ])
      .where('map_id', '=', mapId)
      .execute();
    return rows;
  }
  async insertLocation(mapId: number, loc: MapLocation, itemId: number | null, conn?: Trx): Promise<void> {
    await (conn ?? kysely)
      .insertInto('maplocation')
      .values({ map_id: mapId, item_id: itemId, title: loc.title, x: loc.x, y: loc.y })
      .execute();
  }
  async updateLocation(loc: MapLocation, itemId?: number | null, conn?: Trx): Promise<void> {
    await (conn ?? kysely)
      .updateTable('maplocation')
      .set({ title: loc.title, ...(itemId !== undefined ? { item_id: itemId } : {}), x: loc.x, y: loc.y })
      .where('id', '=', loc.id)
      .execute();
  }
  async deleteLocation(locId: number, conn?: Trx): Promise<void> {
    await (conn ?? kysely).deleteFrom('maplocation').where('id', '=', locId).execute();
  }

  private async _getLinks(item): Promise<{ to_universe_short: string, to_item_short: string, href: string }[]> {
    return await kysely
      .selectFrom('itemlink')
      .select(['to_universe_short', 'to_item_short', 'href'])
      .where('from_item', '=', item.id)
      .execute();
  }

  async getLinks(user: User, universeShortname: string, itemShortname: string): Promise<{ to_universe_short: string, to_item_short: string, href: string }[]> {
    const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.WRITE, true);
    return await this._getLinks(item);
  }

  async getUniverseLinkStats(universe: { id: number, shortname: string }): Promise<{
    edges: { from: string, to: string }[],
    deadLinks: { to_universe_short: string, to_item_short: string, count: number }[],
  }> {
    const edges = await kysely
      .selectFrom('itemlink as il')
      .innerJoin('item as src', 'il.from_item', 'src.id')
      .innerJoin('item as target', (join) => join
        .onRef('target.universe_id', '=', 'src.universe_id')
        .onRef('target.shortname', '=', 'il.to_item_short'))
      .distinct()
      .select(['src.shortname as from', 'target.shortname as to'])
      .where('src.universe_id', '=', universe.id)
      .where('il.to_universe_short', '=', universe.shortname)
      .execute();

    const deadLinks = await kysely
      .selectFrom('itemlink as il')
      .innerJoin('item as src', 'il.from_item', 'src.id')
      .leftJoin('universe as tu', 'tu.shortname', 'il.to_universe_short')
      .leftJoin('item as target', (join) => join
        .onRef('target.universe_id', '=', 'tu.id')
        .onRef('target.shortname', '=', 'il.to_item_short'))
      .select(['il.to_universe_short', 'il.to_item_short'])
      .select((eb) => eb.fn.count<number>('il.from_item').distinct().as('count'))
      .where('src.universe_id', '=', universe.id)
      .where('target.id', 'is', null)
      .groupBy(['il.to_universe_short', 'il.to_item_short'])
      .orderBy('count', 'desc')
      .execute();

    return { edges, deadLinks };
  }

  async getUniverseTabData(universe: { id: number }): Promise<{ [tabType: string]: Set<number> }> {
    const toSet = (rows: { item_id: number }[]) => new Set(rows.map(row => row.item_id));

    const gallery = await kysely
      .selectFrom('itemimage as ii').innerJoin('item as i', 'i.id', 'ii.item_id')
      .select('ii.item_id').distinct().where('i.universe_id', '=', universe.id).execute();

    const lineage = await kysely
      .selectFrom('lineage as l').innerJoin('item as i', 'i.id', 'l.parent_id')
      .select('l.parent_id as item_id').distinct().where('i.universe_id', '=', universe.id)
      .union(kysely
        .selectFrom('lineage as l').innerJoin('item as i', 'i.id', 'l.child_id')
        .select('l.child_id as item_id').distinct().where('i.universe_id', '=', universe.id))
      .execute();

    const timeline = await kysely
      .selectFrom('itemevent as ie').innerJoin('item as i', 'i.id', 'ie.item_id')
      .select('ie.item_id').distinct().where('i.universe_id', '=', universe.id)
      .union(kysely
        .selectFrom('timelineitem as ti').innerJoin('item as i', 'i.id', 'ti.timeline_id')
        .select('ti.timeline_id as item_id').distinct().where('i.universe_id', '=', universe.id))
      .execute();

    const map = await kysely
      .selectFrom('map as m').innerJoin('item as i', 'i.id', 'm.item_id')
      .select('m.item_id').distinct().where('i.universe_id', '=', universe.id).execute();

    const notes = await kysely
      .selectFrom('itemnote as inote')
      .innerJoin('item as i', 'i.id', 'inote.item_id')
      .innerJoin('note as n', 'n.id', 'inote.note_id')
      .select('inote.item_id').distinct()
      .where('i.universe_id', '=', universe.id).where('n.is_public', '=', true).execute();

    const comments = await kysely
      .selectFrom('itemcomment as c').innerJoin('item as i', 'i.id', 'c.item_id')
      .select('c.item_id').distinct().where('i.universe_id', '=', universe.id).execute();

    return {
      gallery: toSet(gallery), lineage: toSet(lineage), timeline: toSet(timeline),
      map: toSet(map), notes: toSet(notes), comments: toSet(comments),
    };
  }

  async handleLinks(item: Item, objData: any, conn?: Trx): Promise<void> {
    if (objData.body && typeof objData.body !== 'string') {
      const links: ({ href: string } & LinkData)[] = [];
      indexedToJson(objData.body as IndexedDocument, (href) => href.startsWith('@') && links.push({ href, ...extractLinkData(href) }));
      const oldLinks = await this._getLinks(item);
      const existingLinks = {};
      const newLinks = {};
      for (const { href } of oldLinks) {
        existingLinks[href] = true;
      }
      const doUpdates = async (conn: Trx) => {
        for (const { universe, item: itemShort, href } of links) {
          newLinks[href] = true;
          if (!existingLinks[href] && itemShort) {
            await conn
              .insertInto('itemlink')
              .values({ from_item: item.id, to_universe_short: universe ?? item.universe_short, to_item_short: itemShort, href })
              .execute();
          }
        }
        for (const { href } of oldLinks) {
          if (!newLinks[href]) {
            await conn.deleteFrom('itemlink').where('from_item', '=', item.id).where('href', '=', href).execute();
          }
        }
      };
      if (conn) {
        await doUpdates(conn);
      } else {
        await withTransaction(doUpdates);
      }
    }
  }

  async fetchEvents(itemId: number, options: EventOptions = {}): Promise<{ id: number, event_title: string | null, abstime: number | null }[]> {
    const { title } = options;
    let query = kysely.selectFrom('itemevent').selectAll().where('item_id', '=', itemId);
    if (title !== undefined && title !== '') {
      query = title === null ? query.where('event_title', 'is', null) : query.where('event_title', '=', title);
    }
    const rows = await query.execute();
    return rows;
  }
  async insertEvents(itemId: number, events: { event_title: string | null, abstime: number | null }[], conn?: Trx): Promise<void> {
    if (!events.length) return;
    await (conn ?? kysely)
      .insertInto('itemevent')
      .values(events.map((event) => ({ item_id: itemId, event_title: event.event_title, abstime: event.abstime })))
      .execute();
  }
  async updateEvent(eventId: number, changes: { event_title: string | null, abstime: number | null }, conn?: Trx): Promise<void> {
    const { event_title, abstime } = changes;
    await (conn ?? kysely).updateTable('itemevent').set({ event_title, abstime }).where('id', '=', eventId).execute();
  }
  async deleteEvents(eventIds: number[], conn?: Trx): Promise<void> {
    if (!eventIds.length) return;
    // Un-import deleted events
    await this.deleteImports(null, eventIds);
    await (conn ?? kysely).deleteFrom('itemevent').where('id', 'in', eventIds).execute();
  }
  async importEvents(itemId: number, eventIds: number[], conn?: Trx): Promise<void> {
    if (!eventIds.length) return;
    await (conn ?? kysely)
      .insertInto('timelineitem')
      .values(eventIds.map((eventId) => ({ timeline_id: itemId, event_id: eventId })))
      .execute();
  }
  async deleteImports(itemId: number | null, eventIds: number[], conn?: Trx): Promise<void> {
    if (!eventIds.length) return;
    await (conn ?? kysely)
      .deleteFrom('timelineitem')
      .where('event_id', 'in', eventIds)
      .$if(itemId !== null, (qb) => qb.where('timeline_id', '=', itemId!))
      .execute();
  }
  async fetchImports(itemId: number): Promise<{ event_id: number, timeline_id: number }[]> {
    return await kysely.selectFrom('timelineitem').selectAll().where('timeline_id', '=', itemId).execute();
  }

  async put(
    user: User | undefined,
    universeShortname: string,
    itemShortname: string,
    changes: { title?: string, shortname?: string, item_type?: string, obj_data?: ObjData, tags?: string[], vault_short?: string | null },
    conn?: Trx
  ): Promise<number> {
    if (!user) throw new UnauthorizedError();
    const { title, shortname, item_type, obj_data, tags, vault_short } = changes;

    if (!title || !obj_data) throw new ValidationError('Missing required fields');
    const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.WRITE);

    await this.handleLinks(item as Item, obj_data, conn);

    if (tags) {
      const trimmedTags = tags.map(tag => tag[0] === '#' ? tag.substring(1) : tag);

      // If tags list is provided, we can just as well handle it here
      await this.putTags(user, universeShortname, itemShortname, trimmedTags, conn);
      const tagLookup = {};
      item.tags?.forEach(tag => {
        tagLookup[tag] = true;
      });
      trimmedTags.forEach(tag => {
        delete tagLookup[tag];
      });
      await this.delTags(user, universeShortname, itemShortname, Object.keys(tagLookup), conn);
    }

    if (shortname !== null && shortname !== undefined && shortname !== item.shortname) {
      // The item shortname has changed, we need to update all links to it to reflect this
      const shortnameError = this.api.universe.validateShortname(shortname);
      if (shortnameError) throw new ValidationError(shortnameError);
    }

    // TODO - there is an argument to be made that perms.ADMIN on the current and/or target vault
    // should be required to change vaults, but I'm not sure I buy it myself...
    const vault = vault_short
      ? await this.api.vault.getOneByShortnames(user, universeShortname, vault_short, perms.WRITE)
      : null;

    const doUpdate = async (conn: Trx) => {
      if (shortname !== null && shortname !== undefined && shortname !== item.shortname) {
        await conn.updateTable('itemlink').set({ to_item_short: shortname }).where('to_item_short', '=', item.shortname).execute();
      }

      await conn
        .updateTable('item')
        .set({
          title,
          shortname: shortname ?? item.shortname,
          item_type: item_type ?? item.item_type,
          obj_data: JSON.stringify(obj_data),
          vault_id: vault_short !== undefined ? vault?.id ?? null : item.vault_id,
          last_updated_by: user.id,
        })
        .where('id', '=', item.id)
        .execute();

      if (
        title !== item.title || shortname !== item.shortname || item_type !== item.item_type || vault_short !== item.vault_short ||
        !deepCompare(obj_data, item.obj_data) || !deepCompare(tags, item.tags)
      ) {
        this.markUpdated(item.id, conn);
        this.api.universe.putUpdatedAtWithTransaction(conn, item.universe_id, new Date());
      }
    };

    if (conn) {
      await doUpdate(conn);
    } else {
      await withTransaction(doUpdate);
    }

    return item.id;
  }

  async markUpdated(itemId: number, conn: Trx): Promise<void> {
    await conn.updateTable('item').set({ updated_at: new Date() }).where('id', '=', itemId).execute();
  }

  async putData(user: User | undefined, universeShortname: string, itemShortname: string, changes): Promise<{ numUpdatedRows: number }> {
    if (!user) throw new UnauthorizedError();

    const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.WRITE);

    item.obj_data = {
      ...item.obj_data,
      ...changes,
    };

    let numUpdatedRows = 0;
    await withTransaction(async (trx) => {
      await this.handleLinks(item as Item, item.obj_data, trx);

      const result = await trx
        .updateTable('item')
        .set({ obj_data: JSON.stringify(item.obj_data), updated_at: new Date(), last_updated_by: user.id })
        .where('id', '=', item.id)
        .executeTakeFirst();
      numUpdatedRows = Number(result.numUpdatedRows);

      this.api.universe.putUpdatedAtWithTransaction(trx, item.universe_id, new Date());
    });

    return { numUpdatedRows };
  }

  // TODO - how should permissions work on this?
  async exists(user: User | undefined, universeShortname: string, itemShortname: string): Promise<boolean> {
    const row = await kysely
      .selectFrom('item')
      .innerJoin('universe', 'universe.id', 'item.universe_id')
      .select('item.id')
      .where('universe.shortname', '=', universeShortname)
      .where('item.shortname', '=', itemShortname)
      .executeTakeFirst();
    return row !== undefined;
  }

  async getLineage(item: BasicItem): Promise<[Parent[], Child[]]> {
    const children = await kysely
      .selectFrom('lineage')
      .innerJoin('item', 'item.id', 'lineage.child_id')
      .select([
        'item.id', 'item.shortname as child_shortname', 'item.title as child_title',
        'lineage.child_title as child_label', 'lineage.parent_title as parent_label',
      ])
      .where('lineage.parent_id', '=', item.id)
      .execute();

    const parents = await kysely
      .selectFrom('lineage')
      .innerJoin('item', 'item.id', 'lineage.parent_id')
      .select([
        'item.id', 'item.shortname as parent_shortname', 'item.title as parent_title',
        'lineage.child_title as child_label', 'lineage.parent_title as parent_label',
      ])
      .where('lineage.child_id', '=', item.id)
      .execute();

    return [parents, children];
  }

  private async getFamilyTreeStep(user: User | undefined, item: BasicItem, depth: number, family: Family = {}): Promise<void> {
    if (depth < 1) {
      family[item.shortname] = { title: item.title, parents: [], children: [] };
      return;
    };

    const [parents, children] = await this.getLineage(item);
    family[item.shortname] = { title: item.title, parents, children };
    for (const { parent_shortname } of parents) {
      if (parent_shortname in family) continue;
      const parent = await this.getByUniverseAndItemShortnames(user, item.universe_short, parent_shortname, perms.READ, true, false);
      await this.getFamilyTreeStep(user, parent, depth - 1, family);
    }
    for (const { child_shortname } of children) {
      if (child_shortname in family) continue;
      const child = await this.getByUniverseAndItemShortnames(user, item.universe_short, child_shortname, perms.READ, true, false);
      await this.getFamilyTreeStep(user, child, depth - 1, family);
    }
  }

  async getFamilyTree(user: User | undefined, item: BasicItem, depth: number): Promise<Family> {
    const family: Family = {};
    await this.getFamilyTreeStep(user, item, depth, family);
    return family;
  }

  /**
   * NOT safe. Make sure user has permissions to the item in question before calling this!
   */
  async putLineage(parent_id: number, child_id: number, parent_title: string | null, child_title: string | null, conn?: Trx): Promise<{ insertId: number }> {
    const data = await (conn ?? kysely)
      .insertInto('lineage')
      .values({ parent_id, child_id, parent_title, child_title })
      .onDuplicateKeyUpdate({ parent_title, child_title })
      .executeTakeFirstOrThrow();
    return { insertId: Number(data.insertId ?? 0) };
  }

  /**
   * NOT safe. Make sure user has permissions to the item in question before calling this!
   */
  async delLineage(parent_id: number, child_id: number, conn?: Trx): Promise<{ numDeletedRows: number }> {
    const data = await (conn ?? kysely)
      .deleteFrom('lineage')
      .where('parent_id', '=', parent_id)
      .where('child_id', '=', child_id)
      .executeTakeFirstOrThrow();
    return { numDeletedRows: Number(data.numDeletedRows) };
  }

  async putTags(user: User | undefined, universeShortname: string, itemShortname: string, tags: string[], conn?: Trx): Promise<{ insertId: number } | void> {
    if (tags.length === 0) return; // Nothing to do
    const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.WRITE, true);
    const tagLookup = {};
    item.tags?.forEach(tag => {
      tagLookup[tag] = true;
    });
    const filteredTags = tags.filter(tag => !tagLookup[tag]);
    if (filteredTags.length === 0) return;
    const data = await (conn ?? kysely)
      .insertInto('tag')
      .values(filteredTags.map((tag) => ({ item_id: item.id, tag })))
      .executeTakeFirstOrThrow();
    return { insertId: Number(data.insertId ?? 0) };
  }

  async delTags(user: User | undefined, universeShortname: string, itemShortname: string, tags: string[], conn?: Trx): Promise<{ numDeletedRows: number } | void> {
    if (tags.length === 0) return; // Nothing to do
    const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.WRITE, true);
    const data = await (conn ?? kysely)
      .deleteFrom('tag')
      .where('item_id', '=', item.id)
      .where('tag', 'in', tags)
      .executeTakeFirstOrThrow();
    return { numDeletedRows: Number(data.numDeletedRows) };
  }

  async snoozeUntil(user: User | undefined, universeShortname: string, itemShortname: string): Promise<{ numUpdatedRows: number } | { insertId: number }> {
    if (!user) throw new UnauthorizedError();
    const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.WRITE);

    const snooze = await kysely
      .selectFrom('snooze')
      .selectAll()
      .where('item_id', '=', item.id)
      .where('snoozed_by', '=', user.id)
      .executeTakeFirst();

    const now = new Date();

    if (snooze) {
      const result = await kysely
        .updateTable('snooze')
        .set({ snoozed_at: now })
        .where('item_id', '=', item.id)
        .where('snoozed_by', '=', user.id)
        .executeTakeFirstOrThrow();
      return { numUpdatedRows: Number(result.numUpdatedRows) };
    } else {
      const result = await kysely
        .insertInto('snooze')
        .values({ item_id: item.id, snoozed_at: now, snoozed_by: user.id })
        .executeTakeFirstOrThrow();
      return { insertId: Number(result.insertId ?? 0) };
    }
  }

  async subscribeNotifs(user: User | undefined, universeShortname: string, itemShortname: string, isSubscribed: boolean): Promise<{ numInsertedOrUpdatedRows: number }> {
    if (!user) throw new UnauthorizedError();
    const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.READ);

    const result = await kysely
      .insertInto('itemnotification')
      .values({ item_id: item.id, user_id: user.id, is_enabled: isSubscribed })
      .onDuplicateKeyUpdate({ is_enabled: isSubscribed })
      .executeTakeFirstOrThrow();

    return { numInsertedOrUpdatedRows: Number(result.numInsertedOrUpdatedRows ?? 0) };
  }

  async del(user: User | undefined, universeShortname: string, itemShortname: string): Promise<void> {
    const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.OWNER, true);

    await withTransaction(async (trx) => {
      // TODO another DELETE-with-JOIN Kysely doesn't support
      await sql`
        DELETE comment
        FROM comment
        INNER JOIN itemcomment AS ic ON ic.comment_id = comment.id
        WHERE ic.item_id = ${item.id}
      `.execute(trx);
      await trx.deleteFrom('item').where('id', '=', item.id).execute();
    });

    await embedder.deleteForItem(item.id);
  }
}
