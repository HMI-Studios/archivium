import fs from 'fs/promises';
import path from 'path';
import { RouteHandler } from '..';
import api from '../../api';
import { BasicItem } from '../../api/models/item';
import { Cond, perms } from '../../api/utils';
import embedder from '../../embedding';
import { UnauthorizedError } from '../../errors';
import logger from '../../logger';

const staticDir = path.join(__dirname, '../../static');

// Find the bundle chunk for the current editor page to preload it
async function findEditorChunk(prefix: string): Promise<string | null> {
  const files = await fs.readdir(path.join(staticDir, 'editor')).catch(() => [] as string[]);
  return files.find((file) => new RegExp(`^${prefix}\\.[a-f0-9]+\\.chunk\\.js$`).test(file)) ?? null;
}

export default {
  /* Terms and Agreements */
  async privacyPolicy(_, res) {
    const content = (await fs.readFile(path.join(staticDir, 'privacy_policy.md'))).toString();
    res.prepareRender('docs', { content });
  },
  async termsOfService(_, res) {
    const content = (await fs.readFile(path.join(staticDir, 'ToS.md'))).toString();
    res.prepareRender('docs', { content });
  },
  async codeOfConduct(_, res) {
    const content = (await fs.readFile(path.join(staticDir, 'code_of_conduct.md'))).toString();
    res.prepareRender('docs', { content });
  },

  /* Home Page */
  async home(req, res) {
    const user = req.session.user;
    if (user) {
      const universes = await api.universe.getMany(user, null, perms.WRITE);
      const followedUniverses = await api.universe.getMany(user, {
        strings: ['fu.user_id = ?', 'fu.is_following = ?'],
        values: [user.id, true],
      }, perms.READ);
      const followedUniverseIds = `(${followedUniverses.map(universe => universe.id).join(',')})`;
      const recentlyUpdated = followedUniverses.length > 0 ? await api.item.getMany(user, null, perms.READ, {
        sort: 'updated_at',
        sortDesc: true,
        limit: 8,
        select: [['lub.username', 'last_updated_by']],
        join: [['LEFT', ['user', 'lub'], new Cond('lub.id = item.last_updated_by')]],
        where: new Cond(`item.universe_id IN ${followedUniverseIds}`)
          .and(new Cond('lub.id <> ?', user.id).or(new Cond('item.last_updated_by IS NULL').and('item.author_id <> ?', user.id))),
      }) : [200, []];
      const oldestUpdated = await api.item.getMany(user, null, perms.WRITE, {
        sort: `GREATEST(IFNULL(snooze.snoozed_at, '1000-01-01'), IFNULL(item.updated_at, '1000-01-01'))`,
        sortDesc: false,
        forceSort: true,
        limit: 16,
        join: [['LEFT', 'snooze', new Cond('snooze.item_id = item.id').and('snooze.snoozed_by = ?', user.id)]],
        where: new Cond('item.updated_at < DATE_SUB(NOW(), INTERVAL 2 DAY)'),
        groupBy: ['snooze.snoozed_at'],
      });
      return res.prepareRender('home', { universes, followedUniverses, recentlyUpdated, oldestUpdated });
    }
    res.prepareRender('home', { universes: [] })
  },

  /* Note pages */
  async notes(req, res) {
    const user = req.session.user;
    if (!user) throw new UnauthorizedError();
    const notes = await api.note.getByUsername(user, user.username, {}, { connections: true });
    const noteAuthors = { [user.id]: user };
    res.prepareRender('notes', {
      notes,
      noteAuthors,
      noteBaseRoute: `/api/users/${user.username}/notes`,
    });
  },

  /* Misc pages */
  async search(req, res) {
    const search = req.getQueryParam('search');
    if (search) {
      const universes = await api.universe.getMany(req.session.user, { strings: ['title LIKE ?'], values: [`%${search}%`] });
      const items: (BasicItem & { snippet?: string, semantic?: boolean })[] = await api.item.getMany(req.session.user, null, perms.READ, { search });
      const notes = req.session.user ? await api.note.getByUsername(req.session.user, req.session.user.username, null, { search }) : [];

      let semanticItems: (BasicItem & { snippet?: string, semantic?: boolean })[] = [];
      try {
        const alreadyMatched = new Set(items.map(item => item.id));
        const results = await embedder.search(req.session.user, { query: search });
        semanticItems = results
          .filter(({ item }) => !alreadyMatched.has(item.id))
          .map(({ item, chunks }) => ({
            ...item,
            snippet: chunks.sort((a, b) => a.score > b.score ? -1 : 1)[0]?.content.substring(0, 100),
            semantic: true,
          }));
      } catch (err) {
        logger.error(`Semantic search failed during page search: ${err}`);
      }

      res.prepareRender('search', { items: [...items, ...semanticItems], universes, notes, search });
    } else {
      res.prepareRender('search', { items: [], universes: [], notes: [], search: '' });
    }
  },

  /* React Editor */
  async editor(req, res) {
    const params = req.params[0]?.split('/') ?? [];
    const data: any = {};
    if (params[0] === 'universes' && params[1]) {
      const [, universeShort] = params;
      data.universe = await api.universe.getOne(req.session.user, { shortname: universeShort });
    }

    if (params[0] === 'universes' && params[2] === 'items' && params[3]) {
      data.preloadChunk = await findEditorChunk('item-edit');
    } else if (params[0] === 'stories' && params[2]) {
      data.preloadChunk = await findEditorChunk('chapter-edit');
    } else if (params[0] === 'notes' && params[1]) {
      data.preloadChunk = await findEditorChunk('note-edit');
    }

    res.prepareRender('editor', data);
  }
} satisfies Record<string, RouteHandler>;
