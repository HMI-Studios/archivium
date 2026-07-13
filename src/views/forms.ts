import { RouteHandler } from ".";

import api from '../api';
import { perms, Tier } from '../api/utils';
import { ADDR_PREFIX } from '../config';
import embedder from '../embedding';
import { ModelError, RateLimitError } from "../errors";
import logger from '../logger';
import { universeLink } from '../templates';
import pages from './pages';

export default {
  async notificationSettings(req, res) {
    const { body, session } = req;
    body['email_notifs'] = body['email_notifs'] === 'on';
    for (const type of Object.values(api.notification.types)) {
      for (const method of Object.values(api.notification.methods)) {
        body[`${type}_${method}`] = body[`notif_${type}_${method}`] === 'on';
        delete body[`notif_${type}_${method}`];
      }
    }
    await api.notification.putSettings(session.user, body);
    return res.redirect(`${ADDR_PREFIX}/settings`);
  },

  async createUniverse(req, res) {
    try {
      await api.universe.post(req.session.user, {
        ...req.body,
        obj_data: decodeURIComponent(req.body.obj_data),
        is_public: req.body.visibility === 'public',
        discussion_enabled: req.body.discussion_enabled === 'enabled',
        discussion_open: req.body.discussion_open === 'enabled',
        mcp_items_enabled: req.body.mcp_items_enabled === 'on',
        mcp_notes_enabled: req.body.mcp_notes_enabled === 'on',
        mcp_discussions_enabled: req.body.mcp_discussions_enabled === 'on',
      });
      res.status(201);
      return res.redirect(`${universeLink(req, req.body.shortname)}/`);
    } catch (err) {
      if (err instanceof ModelError) {
        res.prepareRender('createUniverse', { error: err.message, ...req.body });
        return;
      }
      throw err;
    }
  },

  async editUniverse(req, res) {
    req.body = {
      ...req.body,
      obj_data: decodeURIComponent(req.body.obj_data),
      is_public: req.body.visibility === 'public',
      discussion_enabled: req.body.discussion_enabled === 'enabled',
      discussion_open: req.body.discussion_open === 'enabled',
      mcp_items_enabled: req.body.mcp_items_enabled === 'on',
      mcp_notes_enabled: req.body.mcp_notes_enabled === 'on',
      mcp_discussions_enabled: req.body.mcp_discussions_enabled === 'on',
    }
    try {
      // TODO we need to fix this type nonsense...
      const prevUniverse = await api.universe.getOne(req.session.user, { 'universe.shortname': req.params.universeShortname }, perms.READ);
      const prevSemanticSearchSetting = (prevUniverse.obj_data as any).semanticSearchEnabled;

      const id = await api.universe.put(req.session.user, req.params.universeShortname, req.body);
      const universe = await api.universe.getOne(req.session.user, { 'universe.id': id }, perms.READ);

      if ((universe.obj_data as any).semanticSearchEnabled && !prevSemanticSearchSetting) {
        embedder.enableEmbed(universe);
      } else if (!(universe.obj_data as any).semanticSearchEnabled && prevSemanticSearchSetting) {
        embedder.deleteForUniverse(universe.id);
      }
      if (req.body.next) {
        res.redirect(req.body.next);
      } else {
        res.redirect(`${universeLink(req, universe.shortname)}`);
      }
    } catch (err) {
      if (err instanceof ModelError) {
        res.error = err.message;
        await pages.universe.edit(req, res);
        return;
      }
      throw err;
    }
  },

  async createUniverseThread(req, res) {
    try {
      const { insertId } = await api.discussion.postUniverseThread(req.session.user, req.params.universeShortname, { title: req.body.title });
      if (req.body.comment) {
        await api.discussion.postCommentToThread(req.session.user, insertId, { body: req.body['comment'] });
      }
      return res.redirect(`${universeLink(req, req.params.universeShortname)}/discuss/${insertId}`);
    } catch (err) {
      if (err instanceof ModelError) {
        const universe = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
        res.prepareRender('createUniverseThread', { error: err.message, ...req.body, universe });
        return;
      }
    }
  },

  async commentOnThread(req, res) {
    await api.discussion.postCommentToThread(req.session.user, Number(req.params.threadId), req.body);
    return res.redirect(`${universeLink(req, req.params.universeShortname)}/discuss/${req.params.threadId}#post-comment`);
  },

  async createItem(req, res) {
    try {
      await api.item.post(req.session.user, {
        ...req.body,
      }, req.params.universeShortname);
      return res.redirect(`${universeLink(req, req.params.universeShortname)}/items/${req.body.shortname}`);
    } catch (err) {
      if (err instanceof ModelError) {
        const universe = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
        res.prepareRender('createItem', { error: err.message, ...req.body, universe });
        return;
      }
      throw err;
    }
  },

  async commentOnItem(req, res) {
    await api.discussion.postCommentToItem(req.session.user, req.params.universeShortname, req.params.itemShortname, req.body);
    res.redirect(`${universeLink(req, req.params.universeShortname)}/items/${req.params.itemShortname}?tab=${req.body.tab}#post-comment`);
  },

  async sponsorUniverse(req, res) {
    const { session, params, body } = req;
    await api.universe.putUserSponsoring(session.user, params.universeShortname, Number(body.tier) as Tier);
    res.redirect(`${universeLink(req, params.universeShortname)}/`);
  },

  async createNote(req, res) {
    const { body, session } = req;
    const uuid = await api.note.post(session.user, {
      title: body.note_title,
      is_public: body.note_public === 'on',
      body: body.note_body,
      tags: body.note_tags?.split(' ') ?? [],
    });
    let nextPage;
    if (body.note_item && body.note_universe) {
      await api.note.linkToItem(session.user, body.note_universe, body.note_item, uuid);
      nextPage = nextPage || `${universeLink(req, body.note_universe)}/items/${body.note_item}?tab=notes&note=${uuid}`;
    }
    if (body.note_board && body.note_universe) {
      await api.note.linkToBoard(session.user, body.note_board, uuid);
      nextPage = nextPage || `${universeLink(req, body.note_universe)}/notes/${body.note_board}?note=${uuid}`;
    }
    return res.redirect(nextPage || `${ADDR_PREFIX}/notes?note=${uuid}`);
  },

  async editNote(req, res) {
    const { body, session } = req;
    await api.note.put(session.user, body.note_uuid, {
      title: body.note_title,
      is_public: body.note_public === 'on',
      body: body.note_body,
      items: (body.items ?? []).map(({ item, universe }) => ([null, item, null, universe])),
      boards: body.boards,
      tags: body.note_tags?.split(' ') ?? [],
    });
    let nextPage: string | undefined;
    if (body.note_item && body.note_universe) {
      nextPage = nextPage || `${universeLink(req, body.note_universe)}/items/${body.note_item}?tab=notes&note=${body.note_uuid}`;
    }
    if (body.note_board && body.note_universe) {
      nextPage = nextPage || `${universeLink(req, body.note_universe)}/notes/${body.note_board}?note=${body.note_uuid}`;
    }
    res.redirect(nextPage || `${ADDR_PREFIX}/notes?note=${body.note_uuid}`);
  },

  async createStory(req, res) {
    try {
      await api.story.post(req.session.user, {
        ...req.body,
        is_public: req.body.drafts_public === 'public',
      });
      return res.redirect(`${ADDR_PREFIX}/stories/${req.body.shortname}`);
    } catch (err) {
      if (err instanceof ModelError) {
        res.error = err.message;
        const universes = await api.universe.getMany(req.session.user, null, perms.WRITE);
        res.prepareRender('createStory', { universes: universes ?? [], error: err.message, ...req.body });
        return;
      }
      throw err;
    }
  },

  async editStory(req, res) {
    req.body = {
      ...req.body,
      drafts_public: req.body.drafts_public === 'on',
    }
    try {
      const shortname = await api.story.put(req.session.user, req.params.shortname, req.body);
      res.redirect(`${ADDR_PREFIX}/stories/${shortname}`);
    } catch (err) {
      if (err instanceof ModelError) {
        res.error = err.message;
        await pages.story.edit(req, res);
        return;
      }
      throw err;
    }
  },

  async commentOnChapter(req, res) {
    await api.discussion.postCommentToChapter(req.session.user, req.params.shortname, Number(req.params.index), req.body);
    res.redirect(`${ADDR_PREFIX}/stories/${req.params.shortname}/${req.params.index}#post-comment`);
  },

  async passwordResetRequest(req, res) {
    const { body } = req;
    try {
      const user = await api.user.getOne({ email: body.email });
      await api.email.trySendPasswordReset(user);
      return res.prepareRender('forgotPassword', { success: 'Email sent!' });
    } catch (err) {
      if (err instanceof ModelError) {
        res.status(err.code);
        if (err instanceof RateLimitError) {
          return res.prepareRender('forgotPassword', { error: `Please wait ${(err.data.getDate() - new Date().getTime()) / 1000} seconds before trying again.` });
        } else {
          return res.prepareRender('forgotPassword', { error: `Error ${err.code}: ${err.message}` });
        }
      }
      throw err;
    }
  },

  async resetPassword(req, res) {
    const { body } = req;
    if (body.newPassword !== body.confirmPassword) {
      res.status(400);
      return res.prepareRender('resetPassword', { error: 'New password and confirmation do not match.' });
    }
    try {
      const userId = await api.user.resetPassword(req.params.key, body.newPassword);
      const user = await api.user.getOne({ id: userId });
      res.redirect(`${ADDR_PREFIX}/users/${user.username}`);
    } catch (err) {
      logger.error(err);
      if (err instanceof ModelError) {
        res.status(err.code);
        return res.prepareRender('resetPassword', { error: 'This password reset link seems to be broken or expired — try requesting a new one.' });
      }
      throw err;
    }
  },
} satisfies Record<string, RouteHandler>;
