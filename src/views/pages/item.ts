import { RouteHandler } from '..';
import api from '../../api';
import { Comment } from '../../api/models/discussion';
import { Family, Item } from '../../api/models/item';
import { Note } from '../../api/models/note';
import { User } from '../../api/models/user';
import { getPfpUrl, perms } from '../../api/utils';
import { ForbiddenError, NotFoundError } from '../../errors';
import { FamilyTreeLayout, layoutFamilyTree } from '../../lib/familyTree';
import { RenderedBody, tryRenderContent } from '../../lib/renderContent';
import { universeLink } from '../../templates';
import embedder from '../../embedding';

export default {
  async list(req, res) {
    const search = req.getQueryParam('search');
    const universes = await api.universe.getMany(req.session.user);
    const items = (await api.item.getMany(req.session.user, null, Math.max(perms.READ, Number(req.query.perms)) || perms.READ, {
      sort: req.getQueryParam('sort'),
      sortDesc: req.getQueryParam('sort_order') === 'desc',
      limit: req.getQueryParamAsNumber('limit'),
      type: req.getQueryParam('type'),
      tag: req.getQueryParam('tag'),
      universe: req.getQueryParam('universe'),
      author: req.getQueryParam('author'),
      search,
    })).filter(item => !item.shortname.startsWith('_'));
    const universeCats = universes.reduce((cats, universe) => {
      return { ...cats, [universe.id]: universe.obj_data['cats'] };
    }, {});
    const universe = req.query.universe ? await api.universe.getOne(req.session.user, { 'universe.shortname': req.query.universe }) : null;
    res.prepareRender('itemList', {
      items: items.map(item => ({ ...item, itemTypeName: ((universeCats[item.universe_id] ?? {})[item.item_type] ?? ['Missing Category'])[0] })),
      type: req.query.type,
      tag: req.query.tag,
      universe,
      author: req.query.author,
      showUniverse: true,
      search,
      layout: req.query.layout,
    });
  },

  async create(req, res) {
    const universe = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, perms.WRITE);
    res.prepareRender('createItem', { universe, item_type: req.query.type, shortname: req.query.shortname });
  },

  async view(req, res) {
    const universe = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname });

    let item: Item & { [key: string]: any }; // TODO this is ugly
    try {
      item = await api.item.getByUniverseAndItemShortnames(req.session.user, req.params.universeShortname, req.params.itemShortname) as Item;
    } catch (err) {
      if (err instanceof ForbiddenError) {
        if (req.session.user && universe.author_permissions[req.session.user.id] >= perms.READ) {
          res.status(404);
          res.prepareRender('error', {
            code: 404,
            hint: 'Looks like this item doesn\'t exist yet. Follow the link below to create it:',
            hintLink: `${universeLink(req, req.params.universeShortname)}/items/create?shortname=${req.params.itemShortname}`,
          });
          return;
        }
      }
      throw err;
    }
;
    item.itemTypeName = ((universe.obj_data['cats'] ?? {})[item.item_type] ?? ['Missing Category'])[0];
    item.itemTypeColor = ((universe.obj_data['cats'] ?? {})[item.item_type] ?? [,,'#f3f3f3'])[2];

    let renderedBody: RenderedBody = { type: 'text', content: '' };
    if ('body' in item.obj_data) {
      renderedBody = await tryRenderContent(req, item.obj_data.body, universe.shortname);
    }

    let family: Family = {};
    let familyLayout: FamilyTreeLayout | null = null;
    if ('lineage' in item.obj_data) {
      family = await api.item.getFamilyTree(req.session.user, item, 10);
      familyLayout = layoutFamilyTree(item.shortname, family);
    }

    const [comments, commentUsers] = await api.discussion.getCommentsByItem(item.id, true) as [Comment[], User[]];
    const commenters = {};
    for (const user of commentUsers) {
      user.pfpUrl = getPfpUrl(user);
      delete user.email;
      commenters[user.id] = user;
    }

    const [notes, noteUsers] = await api.note.getByItemShortname(req.session.user, universe.shortname, item.shortname, {}, { connections: true }, true) as [Note[], User[]];
    const noteAuthors = {};
    for (const user of noteUsers) {
      user.pfpUrl = getPfpUrl(user);
      delete user.email;
      noteAuthors[user.id] = user;
    }

    const relatedItems = (universe.obj_data as any).semanticSearchEnabled
      ? (await embedder.getRelatedItems(req.session.user, item.id, universe.id)).map(relatedItem => ({
        ...relatedItem,
        itemTypeName: ((universe.obj_data['cats'] ?? {})[relatedItem.item_type] ?? ['Missing Category'])[0],
      }))
      : [];

    res.prepareRender('item', {
      item, universe, tab: req.query.tab, comments, commenters, notes, noteAuthors, renderedBody,
      commentAction: `${universeLink(req, universe.shortname)}/items/${item.shortname}/comment`,
      noteBaseRoute: `/api/universes/${universe.shortname}/items/${item.shortname}/notes`,
      family, familyLayout, relatedItems,
    });
  },

  async delete(req, res) {
    try {
      const item = await api.item.getByUniverseAndItemShortnames(req.session.user, req.params.universeShortname, req.params.itemShortname, perms.OWNER);
      res.prepareRender('deleteItem', { item });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.redirect(`${universeLink(req, req.params.universeShortname)}/items`);
      }
      throw err;
    }
  },
} satisfies Record<string, RouteHandler>;
