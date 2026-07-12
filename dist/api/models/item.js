"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ItemAPI = void 0;
const buffer_image_size_1 = __importDefault(require("buffer-image-size"));
const __1 = __importDefault(require(".."));
const errors_1 = require("../../errors");
const editor_1 = require("../../lib/editor");
const tiptapHelpers_1 = require("../../lib/tiptapHelpers");
const utils_1 = require("../utils");
const utils_2 = require("../../lib/utils");
function getQuery(selects = [], permsCond, whereConds, options = {}) {
    const query = new utils_1.QueryBuilder()
        .select('item.id')
        .select('item.title')
        .select('item.shortname')
        .select('item.item_type')
        .select('item.created_at')
        .select('item.updated_at')
        .select('item.universe_id')
        .select('user.username', 'author')
        .select('universe.title', 'universe')
        .select('universe.shortname', 'universe_short');
    for (const args of selects) {
        query.select(...args);
    }
    query.select('IFNULL(tag.tags, JSON_ARRAY()) AS tags')
        .from('item')
        .leftJoin('user', new utils_1.Cond('user.id = item.author_id'))
        .innerJoin('universe', new utils_1.Cond('universe.id = item.universe_id'))
        .innerJoin(['authoruniverse', 'au_filter'], new utils_1.Cond('universe.id = au_filter.universe_id').and(permsCond))
        .leftJoin(`(
      SELECT item_id, JSON_ARRAYAGG(tag) as tags
      FROM tag
      GROUP BY item_id
    ) tag`, new utils_1.Cond('tag.item_id = item.id'))
        .where(whereConds)
        .groupBy(['item.id', 'user.username', 'universe.title', ...(options.groupBy ?? [])]);
    if (options.sort) {
        query.orderBy(options.sort, options.sortDesc);
    }
    else {
        query.orderBy('updated_at', true);
    }
    if (options.limit) {
        query.limit(options.limit);
    }
    return query;
}
class MapImageAPI {
    item;
    constructor(item) {
        this.item = item;
    }
    async getOneByItemShort(user, universeShortname, itemShortname, options) {
        const item = await this.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.READ, true);
        return await this.getOneByItem(item, options);
    }
    async getMany(options) {
        const parsedOptions = (0, utils_1.parseData)(options);
        let queryString = `
      SELECT image.id, image.name, image.mimetype, image.data, map.item_id
      FROM map
      INNER JOIN image ON image.id = map.image_id
      WHERE map.image_id IS NOT NULL
    `;
        if (options)
            queryString += ` AND ${parsedOptions.strings.join(' AND ')}`;
        const images = await (0, utils_1.executeQuery)(queryString, parsedOptions.values);
        return images;
    }
    /**
     * The caller of this mehtod must ensure that the user has adequate permissions!
     */
    async getOneByItem(item, options) {
        const data = await this.getMany({ item_id: item.id, ...(options ?? {}) });
        const image = data[0];
        if (!image)
            throw new errors_1.NotFoundError();
        return image;
    }
    async post(user, file, universeShortname, itemShortname) {
        if (!file)
            throw new errors_1.ValidationError('Missing required fields');
        if (!user)
            throw new errors_1.UnauthorizedError();
        const universe = await __1.default.universe.getOne(user, { shortname: universeShortname });
        const totalStoredSize = await __1.default.universe.getTotalStoredByShortname(universe.shortname);
        if (totalStoredSize + file.buffer.length > utils_1.tierLimits[universe.tier ?? 0].images) {
            throw new errors_1.InsufficientStorageError();
        }
        const { originalname, buffer, mimetype } = file;
        const { width, height } = (0, buffer_image_size_1.default)(buffer);
        const item = await this.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.WRITE, true);
        const existingImage = await this.getOneByItem(item).catch((0, utils_1.handleAsNull)(errors_1.NotFoundError));
        let data;
        await (0, utils_1.withTransaction)(async (conn) => {
            // The map row may not exist yet if the client's autosave (which persists a newly added
            // map tab) hasn't landed before this upload request arrives, so create it on demand.
            let map = (await (0, utils_1.executeQuery)('SELECT id FROM map WHERE item_id = ?', [item.id], conn))[0];
            if (!map) {
                const { insertId } = await (0, utils_1.executeQuery)('INSERT INTO map (item_id) VALUES (?)', [item.id], conn);
                map = { id: insertId };
            }
            [data] = await conn.execute('INSERT INTO image (name, mimetype, data) VALUES (?, ?, ?)', [originalname.substring(0, 64), mimetype, buffer]);
            await conn.execute('UPDATE map SET image_id = ?, width = ?, height = ? WHERE id = ?', [data.insertId, width, height, map.id]);
            if (existingImage) {
                await conn.execute(`DELETE FROM image WHERE id = ?`, [existingImage.id]);
            }
        });
        return data;
    }
    async del(user, imageId, conn) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const images = await this.getMany({ 'image.id': imageId });
        const image = images && images[0];
        if (!image)
            throw new errors_1.NotFoundError();
        await this.item.getOne(user, { 'item.id': image.item_id }, utils_1.perms.WRITE); // we need to get the item here to make sure it exists
        await (0, utils_1.executeQuery)(`DELETE FROM image WHERE id = ?`, [imageId], conn);
    }
}
class ItemImageAPI {
    item;
    constructor(item) {
        this.item = item;
    }
    async getOneByItemShort(user, universeShortname, itemShortname, options) {
        const item = await this.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.READ, true);
        const data = await this.getMany({ item_id: item.id, ...(options ?? {}) });
        const image = data[0];
        if (!image)
            throw new errors_1.NotFoundError();
        return image;
    }
    async getMany(options, inclData = true) {
        const parsedOptions = (0, utils_1.parseData)(options);
        let queryString = `
      SELECT
        image.id, itemimage.item_id, image.name, image.mimetype,
        itemimage.label, itemimage.idx ${inclData ? ', image.data' : ''}
      FROM itemimage
      INNER JOIN image ON image.id = itemimage.image_id
    `;
        if (options)
            queryString += ` WHERE ${parsedOptions.strings.join(' AND ')}`;
        queryString += ' ORDER BY itemimage.idx';
        const images = await (0, utils_1.executeQuery)(queryString, parsedOptions.values);
        return images;
    }
    async getManyByItemShort(user, universeShortname, itemShortname, options, inclData = false) {
        const item = await this.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.READ, true);
        const images = await this.getMany({ item_id: item.id, ...(options ?? {}) }, inclData);
        return images;
    }
    async post(user, file, universeShortname, itemShortname) {
        if (!file)
            throw new errors_1.ValidationError('Missing required fields');
        if (!user)
            throw new errors_1.UnauthorizedError();
        const universe = await __1.default.universe.getOne(user, { shortname: universeShortname });
        const totalStoredSize = await __1.default.universe.getTotalStoredByShortname(universe.shortname);
        if (totalStoredSize + file.buffer.length > utils_1.tierLimits[universe.tier ?? 0].images) {
            throw new errors_1.InsufficientStorageError();
        }
        const { originalname, buffer, mimetype } = file;
        const item = await this.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.WRITE, true);
        let data;
        await (0, utils_1.withTransaction)(async (conn) => {
            [data] = await conn.execute(`INSERT INTO image (name, mimetype, data) VALUES (?, ?, ?)`, [originalname.substring(0, 64), mimetype, buffer]);
            await conn.execute(`INSERT INTO itemimage (item_id, image_id, label, idx) VALUES (?, ?, ?, ?)`, [item.id, data.insertId, '', 0]);
        });
        return data;
    }
    async putLabel(user, imageId, label, conn) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const images = await this.getMany({ id: imageId }, false);
        const image = images && images[0];
        if (!image)
            throw new errors_1.NotFoundError();
        await this.item.getOne(user, { 'item.id': image.item_id }); // we need to get the item here to make sure it exists
        return await (0, utils_1.executeQuery)(`UPDATE itemimage SET label = ? WHERE image_id = ?`, [label, imageId], conn);
    }
    async putIdx(user, imageId, idx, conn) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const images = await this.getMany({ id: imageId }, false);
        const image = images && images[0];
        if (!image)
            throw new errors_1.NotFoundError();
        await this.item.getOne(user, { 'item.id': image.item_id }); // we need to get the item here to make sure it exists
        return await (0, utils_1.executeQuery)(`UPDATE itemimage SET idx = ? WHERE image_id = ?`, [idx, imageId], conn);
    }
    async del(user, imageId, conn) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const images = await this.getMany({ id: imageId }, false);
        const image = images && images[0];
        if (!image)
            throw new errors_1.NotFoundError();
        await this.item.getOne(user, { 'item.id': image.item_id }, utils_1.perms.WRITE); // we need to get the item here to make sure it exists
        await (0, utils_1.executeQuery)(`DELETE FROM image WHERE id = ?`, [imageId], conn); // itemimage will be deleted by cascade
    }
}
class ItemAPI {
    image;
    mapImage;
    api;
    constructor(api) {
        this.image = new ItemImageAPI(this);
        this.mapImage = new MapImageAPI(this);
        this.api = api;
    }
    async getOneBasic(user, conditions = {}, permissionsRequired = utils_1.perms.READ, options = {}) {
        const parsedConditions = (0, utils_1.parseData)(conditions);
        const data = await this.getMany(user, parsedConditions, permissionsRequired, { ...options, limit: 1 });
        const item = data[0];
        if (!item) {
            if (user)
                throw new errors_1.ForbiddenError();
            else
                throw new errors_1.UnauthorizedError();
        }
        return item;
    }
    async getOne(user, conditions = {}, permissionsRequired = utils_1.perms.READ, options = {}) {
        const item = {
            ...await this.getOneBasic(user, conditions, permissionsRequired, options),
            events: [],
            map: null,
            gallery: [],
            parents: [],
            children: [],
            links: [],
        };
        const events = await (0, utils_1.executeQuery)(`
      SELECT DISTINCT
        itemevent.event_title, itemevent.abstime,
        item.shortname AS src_shortname, item.title AS src_title, item.id AS src_id
      FROM itemevent
      LEFT JOIN timelineitem ON timelineitem.event_id = itemevent.id
      INNER JOIN item ON itemevent.item_id = item.id
      WHERE itemevent.item_id = ? OR timelineitem.timeline_id = ?
      ORDER BY itemevent.abstime DESC
    `, [item.id, item.id]);
        item.events = events;
        const map = (await (0, utils_1.executeQuery)(`
      SELECT
        map.id, map.width, map.height, map.image_id,
        JSON_ARRAYAGG(JSON_OBJECT(
          'id', loc.id,
          'title', loc.title,
          'universe', universe.shortname,
          'item', item.shortname,
          'itemTitle', item.title,
          'x', loc.x,
          'y', loc.y
        )) as locations
      FROM map
      LEFT JOIN maplocation AS loc ON loc.map_id = map.id
      LEFT JOIN item ON item.id = loc.item_id
      LEFT JOIN universe ON universe.id = item.universe_id
      WHERE map.item_id = ?
      GROUP BY map.id
    `, [item.id]))[0] ?? null;
        if (map?.locations.length === 1 && map.locations[0].id === null) {
            map.locations = [];
        }
        item.map = map;
        const gallery = await (0, utils_1.executeQuery)(`
      SELECT
        image.id, image.name, itemimage.label
      FROM itemimage
      INNER JOIN image ON image.id = itemimage.image_id
      WHERE itemimage.item_id = ?
      ORDER BY itemimage.idx
    `, [item.id]);
        item.gallery = gallery;
        [item.parents, item.children] = await this.getLineage(item);
        const links = await (0, utils_1.executeQuery)(`
      SELECT DISTINCT item.id, item.shortname, item.title, universe.shortname AS universe_short
      FROM itemlink
      INNER JOIN item ON item.id = itemlink.from_item
      INNER JOIN universe ON item.universe_id = universe.id
      WHERE itemlink.to_universe_short = ? AND itemlink.to_item_short = ?
    `, [item.universe_short, item.shortname]);
        item.links = links;
        if (item.obj_data) {
            const objData = JSON.parse(item.obj_data);
            const links = await (0, utils_1.executeQuery)(`
        SELECT to_universe_short, to_item_short, href
        FROM itemlink
        WHERE from_item = ?
      `, [item.id]);
            if (typeof objData.body === 'string') {
                const replacements = {};
                const attachments = {};
                for (const { to_universe_short, to_item_short, href } of links) {
                    const replacement = to_universe_short === item.universe_short ? `${to_item_short}` : `${to_universe_short}/${to_item_short}`;
                    replacements[href] = replacement;
                    const match = href.match(/[?#]/);
                    const attachment = match ? `${match[0]}${href.slice(match.index + 1)}` : '';
                    attachments[href] = attachment;
                }
                objData.body = objData.body.replace(/(?<!\\)(\[[^\]]*?\])\(([^)]+)\)/g, (match, brackets, parens) => {
                    if (parens in replacements) {
                        return `${brackets}(@${replacements[parens]}${attachments[parens]})`;
                    }
                    return match;
                });
            }
            else if (objData.body) {
                const linkMap = {};
                for (const { to_universe_short, to_item_short, href } of links) {
                    linkMap[href] = [to_universe_short, to_item_short];
                }
                (0, tiptapHelpers_1.updateLinks)(objData.body, (href) => {
                    if (href in linkMap) {
                        const linkData = (0, editor_1.extractLinkData)(href);
                        if (linkData.item) {
                            const [toUniverse, toItem] = linkMap[href];
                            if (toUniverse === item.universe_short) {
                                return href.replace(linkData.item, toItem);
                            }
                            else if (linkData.universe) {
                                return href.replace(linkData.universe, toUniverse).replace(linkData.item, toItem);
                            }
                            else {
                                return `@${toUniverse}/${toItem}${linkData.query ? `?${linkData.query}` : ''}${linkData.hash ? `#${linkData.hash}` : ''}`;
                            }
                        }
                    }
                    return href;
                });
            }
            item.obj_data = JSON.stringify(objData);
        }
        if (user) {
            const notifs = await (0, utils_1.executeQuery)(`
        SELECT 1 FROM itemnotification WHERE item_id = ? AND user_id = ? AND is_enabled
      `, [item.id, user.id]);
            item.notifs_enabled = notifs.length === 1;
        }
        return item;
    }
    async getMany(user, conditions, permissionsRequired = utils_1.perms.READ, options = {}) {
        if (options.type) {
            if (!conditions)
                conditions = { strings: [], values: [] };
            conditions.strings.push('item.item_type = ?');
            conditions.values.push(options.type);
        }
        if (options.tag) {
            if (!conditions)
                conditions = { strings: [], values: [] };
            conditions.strings.push('? IN (SELECT tag FROM tag WHERE item_id = item.id)');
            conditions.values.push(options.tag);
        }
        if (options.universe) {
            if (!conditions)
                conditions = { strings: [], values: [] };
            conditions.strings.push('universe.shortname = ?');
            conditions.values.push(options.universe);
        }
        if (options.author) {
            if (!conditions)
                conditions = { strings: [], values: [] };
            conditions.strings.push('user.username = ?');
            conditions.values.push(options.author);
        }
        if (options.sort && !options.forceSort) {
            const validSorts = { 'title': true, 'created_at': true, 'updated_at': true, 'author': true, 'item_type': true };
            if (!validSorts[options.sort]) {
                delete options.sort;
            }
        }
        let permsCond = new utils_1.Cond();
        if (permissionsRequired <= utils_1.perms.READ)
            permsCond = permsCond.or('universe.is_public = ?', 1);
        if (user)
            permsCond = permsCond.or(new utils_1.Cond('au_filter.user_id = ?', user.id)
                .and('au_filter.permission_level >= ?', permissionsRequired));
        let whereConds = new utils_1.Cond();
        if (conditions) {
            for (let i = 0; i < conditions.strings.length; i++) {
                whereConds = whereConds.and(conditions.strings[i], conditions.values[i]);
            }
        }
        if (options.where)
            whereConds = whereConds.and(options.where);
        const selects = [
            ...(options.select ?? []),
            ...(options.includeData ? [['item.obj_data']] : []),
        ];
        const joins = [
            ...(options.join ?? []),
        ];
        if (options.search) {
            const searchCond = new utils_1.Cond('item.title LIKE ?', `%${options.search}%`)
                .or('item.shortname LIKE ?', `%${options.search}%`)
                .or('search_tag.tag = ?', options.search)
                .or('search_tag.tag LIKE ?', `%${options.search}%`)
                .or(`
          CAST(JSON_UNQUOTE(JSON_EXTRACT(item.obj_data, '$.body.text')) AS CHAR CHARACTER SET utf8mb4)
            COLLATE utf8mb4_general_ci LIKE ?
        `, `%${options.search}%`);
            whereConds = whereConds.and(searchCond);
            selects.push([`
        LOCATE(
          ?,
          CAST(JSON_UNQUOTE(JSON_EXTRACT(item.obj_data, '$.body.text')) AS CHAR CHARACTER SET utf8mb4)
            COLLATE utf8mb4_general_ci
        ) AS match_pos`, undefined, options.search]);
            selects.push([`
          CASE
            WHEN LOCATE(
              ?,
              CAST(JSON_UNQUOTE(JSON_EXTRACT(item.obj_data, '$.body.text')) AS CHAR CHARACTER SET utf8mb4)
                COLLATE utf8mb4_general_ci
            ) > 0
            THEN SUBSTRING(
              CAST(JSON_UNQUOTE(JSON_EXTRACT(item.obj_data, '$.body.text')) AS CHAR CHARACTER SET utf8mb4),
              GREATEST(
                1,
                LOCATE(
                  ?,
                  CAST(JSON_UNQUOTE(JSON_EXTRACT(item.obj_data, '$.body.text')) AS CHAR CHARACTER SET utf8mb4)
                    COLLATE utf8mb4_general_ci
                ) - 50
              ),
              100
            )
            ELSE NULL
          END AS snippet`,
                undefined, [options.search, options.search],
            ]);
        }
        const query = getQuery(selects, permsCond, whereConds, options);
        for (const join of joins) {
            query.join(...join);
        }
        if (options.search) {
            query.leftJoin(['tag', 'search_tag'], new utils_1.Cond('search_tag.item_id = item.id'));
        }
        const data = await query.execute();
        return data;
    }
    async getByAuthorUsername(user, username, permissionsRequired, options) {
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
    async getByUniverseId(user, universeId, permissionsRequired, options) {
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
    async getByUniverseAndItemIds(user, universeId, itemId, permissionsRequired = utils_1.perms.READ) {
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
            if (user)
                throw new errors_1.ForbiddenError();
            else
                throw new errors_1.UnauthorizedError();
        }
        return item;
    }
    async getByUniverseShortname(user, shortname, permissionsRequired = utils_1.perms.READ, options) {
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
    async getByUniverseAndItemShortnames(user, universeShortname, itemShortname, permissionsRequired = utils_1.perms.READ, basicOnly = false, includeData = true) {
        const conditions = {
            'universe.shortname': universeShortname,
            'item.shortname': itemShortname,
        };
        if (basicOnly)
            return await this.getOneBasic(user, conditions, permissionsRequired, { includeData });
        else
            return await this.getOne(user, conditions, permissionsRequired, { includeData });
    }
    /**
     *
     * @param {*} user
     * @param {*} universe
     * @param {*} validate
     * @returns {Promise<[number, QueryResult]>}
     */
    async getCountsByUniverse(user, universe, validate = true) {
        if (!universe.is_public && validate) {
            if (!user)
                throw new errors_1.UnauthorizedError();
            if (!(universe.author_permissions[user.id] >= utils_1.perms.READ))
                throw new errors_1.ForbiddenError();
        }
        const data = await (0, utils_1.executeQuery)('SELECT item_type, COUNT(*) AS count FROM item WHERE universe_id = ? GROUP BY item_type', [universe.id]);
        const counts = {};
        let total = 0;
        for (const row of data) {
            counts[row.item_type] = row.count;
            total += row.count;
        }
        return [counts, total];
    }
    async forEachUserToNotify(item, callback) {
        const targetIDs = (await (0, utils_1.executeQuery)(`SELECT user_id FROM itemnotification WHERE item_id = ? AND is_enabled`, [item.id])).map(row => row.user_id);
        for (const userID of targetIDs) {
            const user = await this.api.user.getOne({ 'user.id': userID });
            await callback(user);
        }
    }
    async post(user, body, universeShortName) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const { title, shortname, item_type, parent_id, obj_data } = body;
        try {
            const shortnameError = this.api.universe.validateShortname(shortname);
            if (shortnameError)
                throw new errors_1.ValidationError(shortnameError);
            const universe = await this.api.universe.getOne(user, { 'universe.shortname': universeShortName }, utils_1.perms.WRITE);
            if (!title || !shortname || !item_type || !obj_data)
                throw new errors_1.ValidationError('Missing required fields');
            let data;
            await (0, utils_1.withTransaction)(async (conn) => {
                const queryString = `
          INSERT INTO item (
            title,
            shortname,
            item_type,
            author_id,
            universe_id,
            parent_id,
            obj_data,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        `;
                [data] = await conn.execute(queryString, [
                    title,
                    shortname,
                    item_type,
                    user.id,
                    universe.id,
                    parent_id ?? null,
                    obj_data,
                    new Date(),
                    new Date(),
                ]);
                await conn.execute(`
          INSERT INTO itemnotification (item_id, user_id, is_enabled) VALUES (?, ?, ?)
        `, [data.insertId, user.id, true]);
                this.api.universe.putUpdatedAtWithTransaction(conn, universe.id, new Date());
            });
            if (!data) {
                throw new errors_1.ModelError('Failed to insert item');
            }
            return data;
        }
        catch (err) {
            if (err.code === 'ER_DUP_ENTRY')
                throw new errors_1.ValidationError(`Shortname "${shortname}" already in use in this universe, please choose another.`);
            throw err;
        }
    }
    async save(user, universeShortname, itemShortname, body) {
        let item;
        await (0, utils_1.withTransaction)(async (conn) => {
            // Actually save item
            const changes = {
                title: body.title,
                shortname: body.shortname,
                item_type: body.item_type,
                obj_data: JSON.stringify(body.obj_data),
                tags: body.tags ?? [],
            };
            const itemId = await this.put(user, universeShortname, itemShortname, changes, conn);
            item = await this.getOne(user, { 'item.id': itemId }, utils_1.perms.WRITE);
            let dataChanged = false;
            // Handle lineage data
            if (body.parents || body.children) {
                const existingParents = {};
                const existingChildren = {};
                for (const parent of item.parents)
                    existingParents[parent.parent_shortname] = parent;
                for (const child of item.children)
                    existingChildren[child.child_shortname] = child;
                const [newParents, newChildren] = [{}, {}];
                for (const { parent_shortname, parent_label, child_label } of body.parents ?? []) {
                    const parent = await this.getByUniverseAndItemShortnames(user, universeShortname, parent_shortname, utils_1.perms.WRITE).catch((0, utils_1.handleAsNull)([errors_1.NotFoundError, errors_1.ForbiddenError]));
                    if (!parent)
                        continue;
                    newParents[parent_shortname] = true;
                    if (!(parent_shortname in existingParents)
                        || existingParents[parent_shortname].parent_label !== parent_label
                        || existingParents[parent_shortname].child_label !== child_label) {
                        dataChanged = true;
                        await this.putLineage(parent.id, item.id, parent_label ?? null, child_label ?? null, conn);
                    }
                }
                for (const { child_shortname, parent_label, child_label } of body.children ?? []) {
                    const child = await this.getByUniverseAndItemShortnames(user, universeShortname, child_shortname, utils_1.perms.WRITE).catch((0, utils_1.handleAsNull)([errors_1.NotFoundError, errors_1.ForbiddenError]));
                    if (!child)
                        continue;
                    newChildren[child_shortname] = true;
                    if (!(child_shortname in existingChildren)
                        || existingChildren[child_shortname].parent_label !== parent_label
                        || existingChildren[child_shortname].child_label !== child_label) {
                        dataChanged = true;
                        await this.putLineage(item.id, child.id, parent_label ?? null, child_label ?? null, conn);
                    }
                }
                for (const { parent_shortname } of item.parents) {
                    if (!newParents[parent_shortname]) {
                        const parent = await this.getByUniverseAndItemShortnames(user, universeShortname, parent_shortname, utils_1.perms.WRITE);
                        dataChanged = true;
                        await this.delLineage(parent.id, item.id, conn);
                    }
                }
                for (const { child_shortname } of item.children) {
                    if (!newChildren[child_shortname]) {
                        const child = await this.getByUniverseAndItemShortnames(user, universeShortname, child_shortname, utils_1.perms.WRITE);
                        dataChanged = true;
                        await this.delLineage(item.id, child.id, conn);
                    }
                }
            }
            // Handle timeline data
            if (body.events) {
                const myEvents = body.events?.filter(event => event.src_id === item.id);
                const myImports = body.events?.filter(event => event.src_id !== item.id);
                if (myEvents) {
                    const events = await this.fetchEvents(item.id);
                    const existingEvents = events.reduce((acc, event) => ({ ...acc, [event.event_title ?? null]: event }), {});
                    const newEvents = myEvents.filter(event => !existingEvents[event.event_title]);
                    const updatedEvents = myEvents.filter(event => existingEvents[event.event_title] && (existingEvents[event.event_title].event_title !== event.event_title
                        || existingEvents[event.event_title].abstime !== event.abstime)).map(({ event_title, abstime }) => ({ event_title, abstime, id: existingEvents[event_title].id }));
                    const newEventMap = myEvents.reduce((acc, event) => ({ ...acc, [event.event_title ?? null]: true }), {});
                    const deletedEvents = events.filter(event => !newEventMap[event.event_title]).map(event => event.id);
                    await this.insertEvents(item.id, newEvents, conn);
                    for (const event of updatedEvents) {
                        await this.updateEvent(event.id, event, conn);
                    }
                    await this.deleteEvents(deletedEvents, conn);
                    if (newEvents.length > 0 || updatedEvents.length > 0 || deletedEvents.length > 0) {
                        dataChanged = true;
                    }
                }
                if (myImports) {
                    const imports = await this.fetchImports(item.id);
                    const existingImports = imports.reduce((acc, ti) => ({ ...acc, [ti.event_id]: ti }), {});
                    const newImports = [];
                    const importsMap = {};
                    for (const { src_id: itemId, event_title: eventTitle } of myImports) {
                        const event = (await this.fetchEvents(itemId, { title: eventTitle }))[0];
                        if (!event)
                            continue;
                        if (!(event.id in existingImports)) {
                            newImports.push(event.id);
                        }
                        importsMap[event.id] = true;
                    }
                    const deletedImports = imports.filter(ti => !importsMap[ti.event_id]).map(ti => ti.event_id);
                    await this.importEvents(item.id, newImports, conn);
                    await this.deleteImports(item.id, deletedImports, conn);
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
                        await this.image.putLabel(user, img.id, img.label, conn);
                    }
                    if (oldImages[img.id] && i !== oldImages[img.id].idx) {
                        dataChanged = true;
                        await this.image.putIdx(user, img.id, i, conn);
                    }
                }));
                for (const img of existingImages ?? []) {
                    if (!newImages[img.id]) {
                        dataChanged = true;
                        await this.image.del(user, img.id, conn);
                    }
                }
            }
            // Handle map data
            if (body.map) {
                dataChanged = true;
                let mapId;
                if (body.map.id === null) {
                    dataChanged = true;
                    mapId = await this.insertMap(item.id, body.map, conn);
                }
                else {
                    mapId = body.map.id;
                }
                // TODO: bunch of typing nonsense here too
                const existingLocations = (await this.fetchLocations(mapId)).reduce((acc, loc) => ({ ...acc, [loc.id]: loc }), {});
                const updatedLocations = body.map.locations.filter(loc => loc.id && existingLocations[loc.id] && (existingLocations[loc.id].x !== loc.x
                    || existingLocations[loc.id].y !== loc.y
                    || existingLocations[loc.id].universe !== loc.universe
                    || existingLocations[loc.id].item !== loc.item));
                const newLocations = body.map.locations.filter(loc => loc.id === null || !(loc.id in existingLocations));
                const deletedLocations = body.map.locations.reduce((locations, loc) => {
                    if (loc.id && loc.id in locations)
                        delete locations[loc.id];
                    return locations;
                }, { ...existingLocations });
                for (const loc of newLocations) {
                    const targetItem = (loc.item && loc.universe)
                        ? await this.getByUniverseAndItemShortnames(user, loc.universe, loc.item, utils_1.perms.READ, true)
                        : null;
                    await this.insertLocation(mapId, loc, targetItem?.id ?? null, conn);
                }
                for (const loc of updatedLocations) {
                    let targetItemId = undefined;
                    if (loc.item !== existingLocations[loc.id].item || loc.universe !== existingLocations[loc.id].universe) {
                        if (loc.item && loc.universe) {
                            const targetItem = await this.getByUniverseAndItemShortnames(user, loc.universe, loc.item, utils_1.perms.READ, true);
                            targetItemId = targetItem.id;
                        }
                        else {
                            targetItemId = null;
                        }
                    }
                    await this.updateLocation(loc, targetItemId, conn);
                }
                for (const locId in deletedLocations) {
                    await this.deleteLocation(Number(locId));
                }
                if (newLocations.length > 0 || updatedLocations.length > 0 || Object.keys(deletedLocations).length > 0) {
                    dataChanged = true;
                }
            }
            if (dataChanged) {
                this.markUpdated(item.id, conn);
            }
        });
        return item.id;
    }
    async insertMap(itemId, map, conn) {
        const { insertId } = await (0, utils_1.executeQuery)(`
      INSERT INTO map (width, height, image_id, item_id) VALUES (?, ?, ?, ?)
    `, [map.width, map.height, map.image_id ?? null, itemId], conn);
        return insertId;
    }
    async fetchLocations(mapId) {
        let queryString = `SELECT * FROM maplocation WHERE map_id = ?`;
        const values = [mapId];
        return await (0, utils_1.executeQuery)(queryString, values);
    }
    async insertLocation(mapId, loc, itemId, conn) {
        await (0, utils_1.executeQuery)(`
      INSERT INTO maplocation (map_id, item_id, title, x, y) VALUES (?, ?, ?, ?, ?)
    `, [mapId, itemId, loc.title, loc.x, loc.y], conn);
    }
    async updateLocation(loc, itemId, conn) {
        await (0, utils_1.executeQuery)(`
      UPDATE maplocation
      SET title = ?, ${itemId !== undefined ? 'item_id = ?,' : ''} x = ?, y = ?
      WHERE id = ?
    `, [loc.title, ...(itemId !== undefined ? [itemId] : []), loc.x, loc.y, loc.id], conn);
    }
    async deleteLocation(locId, conn) {
        await (0, utils_1.executeQuery)(`
      DELETE FROM maplocation WHERE id = ?
    `, [locId], conn);
    }
    async _getLinks(item) {
        const result = await (0, utils_1.executeQuery)('SELECT to_universe_short, to_item_short, href FROM itemlink WHERE from_item = ?', [item.id]);
        return result;
    }
    async getLinks(user, universeShortname, itemShortname) {
        const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.WRITE, true);
        return await this._getLinks(item);
    }
    async handleLinks(item, objData, conn) {
        if (objData.body && typeof objData.body !== 'string') {
            const links = [];
            (0, tiptapHelpers_1.indexedToJson)(objData.body, (href) => href.startsWith('@') && links.push({ href, ...(0, editor_1.extractLinkData)(href) }));
            const oldLinks = await this._getLinks(item);
            const existingLinks = {};
            const newLinks = {};
            for (const { href } of oldLinks) {
                existingLinks[href] = true;
            }
            const doUpdates = async (conn) => {
                for (const { universe, item: itemShort, href } of links) {
                    newLinks[href] = true;
                    if (!existingLinks[href]) {
                        await conn.execute('INSERT INTO itemlink (from_item, to_universe_short, to_item_short, href) VALUES (?, ?, ?, ?)', [item.id, universe ?? item.universe_short, itemShort, href]);
                    }
                }
                for (const { href } of oldLinks) {
                    if (!newLinks[href]) {
                        await conn.execute('DELETE FROM itemlink WHERE from_item = ? AND href = ?', [item.id, href]);
                    }
                }
            };
            if (conn) {
                await doUpdates(conn);
            }
            else {
                await (0, utils_1.withTransaction)(doUpdates);
            }
        }
    }
    async fetchEvents(itemId, options = {}) {
        let queryString = `SELECT * FROM itemevent WHERE item_id = ?`;
        const values = [itemId];
        if (options.title) {
            queryString += ` AND event_title = ?`;
            values.push(options.title);
        }
        return await (0, utils_1.executeQuery)(queryString, values);
    }
    async insertEvents(itemId, events, conn) {
        if (!events.length)
            return;
        const queryString = 'INSERT INTO itemevent (item_id, event_title, abstime) VALUES ' + events.map(() => '(?, ?, ?)').join(',');
        const values = events.reduce((acc, event) => ([...acc, itemId, event.event_title, event.abstime]), []);
        await (0, utils_1.executeQuery)(queryString, values, conn);
    }
    async updateEvent(eventId, changes, conn) {
        const { event_title, abstime } = changes;
        const queryString = 'UPDATE itemevent SET event_title = ?, abstime = ? WHERE id = ?';
        await (0, utils_1.executeQuery)(queryString, [event_title, abstime, eventId], conn);
    }
    async deleteEvents(eventIds, conn) {
        if (!eventIds.length)
            return;
        // Un-import deleted events
        await this.deleteImports(null, eventIds);
        const [whereClause, values] = eventIds.reduce((cond, id) => cond.or('id = ?', id), new utils_1.Cond()).export();
        const queryString = `DELETE FROM itemevent WHERE ${whereClause};`;
        await (0, utils_1.executeQuery)(queryString, values.filter(val => val !== undefined), conn);
    }
    async importEvents(itemId, eventIds, conn) {
        if (!eventIds.length)
            return;
        const queryString = 'INSERT INTO timelineitem (timeline_id, event_id) VALUES ' + eventIds.map(() => '(?, ?)').join(',');
        const values = eventIds.reduce((acc, eventId) => ([...acc, itemId, eventId]), []);
        await (0, utils_1.executeQuery)(queryString, values, conn);
    }
    async deleteImports(itemId, eventIds, conn) {
        if (!eventIds.length)
            return;
        let cond = eventIds.reduce((cond, id) => cond.or('event_id = ?', id), new utils_1.Cond());
        if (itemId !== null)
            cond = cond.and('timeline_id = ?', itemId);
        const [whereClause, values] = cond.export();
        const queryString = `DELETE FROM timelineitem WHERE ${whereClause};`;
        await (0, utils_1.executeQuery)(queryString, values.filter(val => val !== undefined), conn);
    }
    async fetchImports(itemId) {
        const queryString = `SELECT * FROM timelineitem WHERE timeline_id = ?`;
        const values = [itemId];
        return await (0, utils_1.executeQuery)(queryString, values);
    }
    async put(user, universeShortname, itemShortname, changes, conn) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const { title, shortname, item_type, obj_data, tags } = changes;
        if (!title || !obj_data)
            throw new errors_1.ValidationError('Missing required fields');
        const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.WRITE);
        const objData = JSON.parse(obj_data);
        await this.handleLinks(item, objData, conn);
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
            if (shortnameError)
                throw new errors_1.ValidationError(shortnameError);
        }
        const doUpdate = async (conn) => {
            if (shortname !== null && shortname !== undefined && shortname !== item.shortname) {
                await conn.execute('UPDATE itemlink SET to_item_short = ? WHERE to_item_short = ?', [shortname, item.shortname]);
            }
            const queryString = `
        UPDATE item
        SET
          title = ?,
          shortname = ?,
          item_type = ?,
          obj_data = ?,
          last_updated_by = ?
        WHERE id = ?;
      `;
            await conn.execute(queryString, [title, shortname ?? item.shortname, item_type ?? item.item_type, JSON.stringify(objData), user.id, item.id]);
            if (title !== item.title || shortname !== item.shortname || item_type !== item.item_type ||
                !(0, utils_2.deepCompare)(objData, JSON.parse(item.obj_data)) || !(0, utils_2.deepCompare)(tags, item.tags)) {
                this.markUpdated(item.id, conn);
                this.api.universe.putUpdatedAtWithTransaction(conn, item.universe_id, new Date());
            }
        };
        if (conn) {
            await doUpdate(conn);
        }
        else {
            await (0, utils_1.withTransaction)(doUpdate);
        }
        return item.id;
    }
    async markUpdated(itemId, conn) {
        await conn.execute('UPDATE item SET updated_at = ? WHERE id = ?', [new Date(), itemId]);
    }
    async putData(user, universeShortname, itemShortname, changes) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.WRITE);
        item.obj_data = {
            ...JSON.parse(item.obj_data),
            ...changes,
        };
        let data;
        await (0, utils_1.withTransaction)(async (conn) => {
            await this.handleLinks(item, item.obj_data, conn);
            const queryString = `UPDATE item SET obj_data = ?, updated_at = ?, last_updated_by = ? WHERE id = ?;`;
            [data] = await conn.execute(queryString, [JSON.stringify(item.obj_data), new Date(), user.id, item.id]);
            this.api.universe.putUpdatedAtWithTransaction(conn, item.universe_id, new Date());
        });
        return data;
    }
    // TODO - how should permissions work on this?
    async exists(user, universeShortname, itemShortname) {
        const queryString = `
      SELECT 1
      FROM item
      INNER JOIN universe ON universe.id = item.universe_id
      WHERE universe.shortname = ? AND item.shortname = ?;
    `;
        const data = await (0, utils_1.executeQuery)(queryString, [universeShortname, itemShortname]);
        return data.length > 0;
    }
    async getLineage(item) {
        const children = await (0, utils_1.executeQuery)(`
      SELECT
        item.id, item.shortname AS child_shortname, item.title AS child_title,
        lineage.child_title AS child_label, lineage.parent_title AS parent_label
      FROM lineage
      INNER JOIN item ON item.id = lineage.child_id
      WHERE lineage.parent_id = ?
    `, [item.id]);
        const parents = await (0, utils_1.executeQuery)(`
      SELECT
        item.id, item.shortname AS parent_shortname, item.title AS parent_title,
        lineage.child_title AS child_label, lineage.parent_title AS parent_label
      FROM lineage
      INNER JOIN item ON item.id = lineage.parent_id
      WHERE lineage.child_id = ?
    `, [item.id]);
        return [parents, children];
    }
    async getFamilyTreeStep(user, item, depth, family = {}) {
        if (depth < 1) {
            family[item.shortname] = { title: item.title, parents: [], children: [] };
            return;
        }
        ;
        const [parents, children] = await this.getLineage(item);
        family[item.shortname] = { title: item.title, parents, children };
        for (const { parent_shortname } of parents) {
            if (parent_shortname in family)
                continue;
            const parent = await this.getByUniverseAndItemShortnames(user, item.universe_short, parent_shortname, utils_1.perms.READ, true, false);
            await this.getFamilyTreeStep(user, parent, depth - 1, family);
        }
        for (const { child_shortname } of children) {
            if (child_shortname in family)
                continue;
            const child = await this.getByUniverseAndItemShortnames(user, item.universe_short, child_shortname, utils_1.perms.READ, true, false);
            await this.getFamilyTreeStep(user, child, depth - 1, family);
        }
    }
    async getFamilyTree(user, item, depth) {
        const family = {};
        await this.getFamilyTreeStep(user, item, depth, family);
        return family;
    }
    /**
     * NOT safe. Make sure user has permissions to the item in question before calling this!
     */
    async putLineage(parent_id, child_id, parent_title, child_title, conn) {
        const queryString = `
      INSERT INTO lineage (parent_id, child_id, parent_title, child_title) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE parent_title = ?, child_title = ?
    `;
        const data = await (0, utils_1.executeQuery)(queryString, [parent_id, child_id, parent_title, child_title, parent_title, child_title], conn);
        return data;
    }
    /**
     * NOT safe. Make sure user has permissions to the item in question before calling this!
     */
    async delLineage(parent_id, child_id, conn) {
        const queryString = `DELETE FROM lineage WHERE parent_id = ? AND child_id = ?;`;
        const data = await (0, utils_1.executeQuery)(queryString, [parent_id, child_id], conn);
        return data;
    }
    async putTags(user, universeShortname, itemShortname, tags, conn) {
        if (tags.length === 0)
            return; // Nothing to do
        const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.WRITE, true);
        const tagLookup = {};
        item.tags?.forEach(tag => {
            tagLookup[tag] = true;
        });
        const filteredTags = tags.filter(tag => !tagLookup[tag]);
        const valueString = filteredTags.map(() => `(?, ?)`).join(',');
        const valueArray = filteredTags.reduce((arr, tag) => [...arr, item.id, tag], []);
        if (!valueString)
            return;
        const queryString = `INSERT INTO tag (item_id, tag) VALUES ${valueString};`;
        const data = await (0, utils_1.executeQuery)(queryString, valueArray, conn);
        return data;
    }
    async delTags(user, universeShortname, itemShortname, tags, conn) {
        if (tags.length === 0)
            return; // Nothing to do
        const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.WRITE, true);
        const whereString = tags.map(() => `tag = ?`).join(' OR ');
        if (!whereString)
            return;
        const queryString = `DELETE FROM tag WHERE item_id = ? AND (${whereString});`;
        const data = await (0, utils_1.executeQuery)(queryString, [item.id, ...tags], conn);
        return data;
    }
    async snoozeUntil(user, universeShortname, itemShortname) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.WRITE);
        const snooze = (await (0, utils_1.executeQuery)(`SELECT * FROM snooze WHERE item_id = ${item.id} AND snoozed_by = ${user.id};`))[0];
        const now = new Date();
        if (snooze) {
            return await (0, utils_1.executeQuery)(`UPDATE snooze SET snoozed_at = ? WHERE item_id = ? AND snoozed_by = ?;`, [now, item.id, user.id]);
        }
        else {
            return await (0, utils_1.executeQuery)(`INSERT INTO snooze (item_id, snoozed_at, snoozed_by) VALUES (?, ?, ?);`, [item.id, now, user.id]);
        }
    }
    async subscribeNotifs(user, universeShortname, itemShortname, isSubscribed) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.READ);
        return await (0, utils_1.executeQuery)(`
        INSERT INTO itemnotification (item_id, user_id, is_enabled) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE is_enabled = ?
      `, [item.id, user.id, isSubscribed, isSubscribed]);
    }
    async del(user, universeShortname, itemShortname) {
        const item = await this.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.OWNER, true);
        await (0, utils_1.withTransaction)(async (conn) => {
            await conn.execute(`
          DELETE comment
          FROM comment
          INNER JOIN itemcomment AS ic ON ic.comment_id = comment.id
          WHERE ic.item_id = ?;
        `, [item.id]);
            await conn.execute(`DELETE FROM item WHERE id = ?;`, [item.id]);
        });
    }
}
exports.ItemAPI = ItemAPI;
