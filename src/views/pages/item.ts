import { RouteHandler } from '..';
import api from '../../api';
import { CommenterUserBasic } from '../../api/models/discussion';
import { Family, Item } from '../../api/models/item';
import { getPfpUrl, perms } from '../../api/utils';
import embedder from '../../embedding';
import { ForbiddenError, NotFoundError } from '../../errors';
import { FamilyTreeLayout, layoutFamilyTree } from '../../lib/familyTree';
import { itemLayoutTabs, layoutTabKey } from '../../lib/itemTypeConfig';
import { RenderedBody, tryRenderContent } from '../../lib/renderContent';
import { buildLayoutView, LayoutView } from '../../lib/tabLayout';
import { universeLink } from '../../templates';

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
    const vaults = await api.vault.getManyByUniverseShortname(req.session.user, universe.shortname, perms.WRITE);
    res.prepareRender('createItem', { universe, vaults, item_type: req.query.type, shortname: req.query.shortname });
  },

  async view(req, res) {
    const universe = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname });

    let item: Item & { [key: string]: any }; // TODO this is ugly
    try {
      item = await api.item.getByUniverseAndItemShortnames(req.session.user, req.params.universeShortname, req.params.itemShortname) as Item;
    } catch (err) {
      if (err instanceof ForbiddenError) {
        if (req.session.user && universe.author_permissions[req.session.user.id] >= perms.READ) {
          let hint: string | undefined = undefined;
          let hintLink: string | undefined = undefined;
          if (universe.author_permissions[req.session.user.id] >= perms.WRITE) {
            hint = 'Looks like this item doesn\'t exist yet. Follow the link below to create it:';
            hintLink = `${universeLink(req, req.params.universeShortname)}/items/create?shortname=${req.params.itemShortname}`;
          }
          res.status(404);
          res.prepareRender('error', {
            code: 404,
            hint,
            hintLink,
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
    if (item.obj_data && 'body' in item.obj_data) {
      renderedBody = await tryRenderContent(req, item.obj_data.body, universe.shortname);
    }

    const layoutTabs: (LayoutView & { key: string })[] = itemLayoutTabs(item.obj_data ?? {}, universe.obj_data)
      .map(({ layout, data }) => ({ ...buildLayoutView(layout, data, item.title), key: layoutTabKey(layout.id) }));

    let family: Family = {};
    let familyLayout: FamilyTreeLayout | null = null;
    if (item.obj_data && 'lineage' in item.obj_data) {
      family = await api.item.getFamilyTree(req.session.user, item, 10);
      familyLayout = layoutFamilyTree(item.shortname, family);
    }

    const [comments, commentUsers = []] = await api.discussion.getCommentsByItem(item.id, true);
    const commenters: { [id: number]: CommenterUserBasic & { pfpUrl: string } } = {};
    for (const user of commentUsers) {
      commenters[user.id] = { ...user, pfpUrl: getPfpUrl(user) };
    }

    const [notes, noteUsers = []] = await api.note.getByItemShortname(req.session.user, universe.shortname, item.shortname, {}, { connections: true }, true);
    const noteAuthors: { [id: number]: CommenterUserBasic & { pfpUrl: string } } = {};
    for (const user of noteUsers) {
      noteAuthors[user.id] = { ...user, pfpUrl: getPfpUrl(user) };
    }

    const relatedItems = universe.obj_data.semanticSearchEnabled
      ? (await embedder.getRelatedItems(req.session.user, item.id, universe.id)).map(relatedItem => ({
        ...relatedItem,
        itemTypeName: ((universe.obj_data['cats'] ?? {})[relatedItem.item_type] ?? ['Missing Category'])[0],
      }))
      : [];

    res.prepareRender('item', {
      item, universe, tab: req.query.tab, comments, commenters, notes, noteAuthors, renderedBody,
      commentAction: `${universeLink(req, universe.shortname)}/items/${item.shortname}/comment`,
      noteBaseRoute: `/api/universes/${universe.shortname}/items/${item.shortname}/notes`,
      family, familyLayout, relatedItems, layoutTabs,
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
