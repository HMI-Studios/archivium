import { Express, Handler, Request, Response } from 'express';
import { ADDR_PREFIX } from '../config';
import Auth from '../middleware/auth';
import { render, universeLink } from '../templates';
import { tiers } from '../api/utils';
import logger from '../logger';
import * as ReCaptcha from '../middleware/reCaptcha';
import Theme from '../middleware/theme';
import themes from '../themes';

import pages from './pages';
import forms from './forms';
import { RequestError } from '../errors';
import { HttpStatusCode } from 'axios';

type Method = 'get' | 'post';
type Site = 'DISPLAY' | 'NORMAL' | 'ALL';
type SiteCheck = (req: Request<{ [key: string]: string }>) => boolean;
type RouterFn = (...args: [string, SiteCheck, Handler[], RouteHandler]) => void;
export type RouteHandler = (req: Request<{ [key: string]: string }>, res: Response) => Promise<void> | void;

const sites: Record<Site, SiteCheck> = {
  DISPLAY: (req) => !!req.headers['x-subdomain'],
  NORMAL: (req) => !req.headers['x-subdomain'],
  ALL: () => true,
};

export default function(app: Express) {
  app.use((req, res, next) => {
    req.getQueryParam = (key: string): string | undefined => {
      const value = req.query[key];
      if (typeof value !== 'string' && value !== undefined) {
        throw new RequestError(`Query parameter "${key}" is required and must be a string`, { code: HttpStatusCode.BadRequest });
      }
      return value;
    };
    req.getQueryParamAsNumber = (key: string): number | undefined => {
      const value = req.getQueryParam(key);
      if (value !== undefined && (value.trim() === '' || isNaN(Number(value)))) {
        throw new RequestError(`Parameter ${key} expected to be numeric, but wasn't`, { code: HttpStatusCode.BadRequest });
      }
      return Number(value);
    };

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.prepareRender = (template, data={}) => {
      res.templateData = { template, data };
    };
    next();
  });


  app.use(Theme);

  const doRender: RouteHandler = async (req, res) => {
    if (res.statusCode === 302) return; // We did a redirect, no need to render.
    if (res.statusCode === 401) { // We don't have permission to be here, redirect to login page.
      const pageQuery = new URLSearchParams();
      if (req.useExQuery) {
        pageQuery.append('page', req.query.page as string);
        pageQuery.append('search', req.query.search as string);
      } else {
        const searchQueries = new URLSearchParams(req.query as Record<string, string>);
        pageQuery.append('page', req.targetPage ?? req.path);
        if (searchQueries.toString()) pageQuery.append('search', searchQueries.toString());
      }
      if (req.params.universeShortname && !req.forceLogin) {
        return res.redirect(`${universeLink(req, req.params.universeShortname)}/?${pageQuery.toString()}`);
      } else {
        return res.redirect(`${ADDR_PREFIX}/login?${pageQuery.toString()}`);
      }
    }
    try {
      if (!res.templateData) throw `Code ${res.statusCode} returned by page handler.`;
      const { template, data } = res.templateData;
      res.end(await render(req, template, data));
    } catch (err) {
      logger.error(`Error ${res.statusCode} rendered.`);
      logger.error(err);
      res.end(await render(req, 'error', { code: res.statusCode }));
    }
  };

  function use(method: Method, path: string, site: SiteCheck, middleware: Handler[], handler: RouteHandler): void {
    app[method](`${ADDR_PREFIX}${path}`, ...middleware, async (req: Request<{ [key: string]: string }>, res, next) => {
      if (site(req) && !res.headersSent) {
        try {
          await handler(req, res);
        } catch (err) {
          logger.error(err);
          if (err instanceof RequestError) {
            res.status(err.code);
          } else {
            res.status(HttpStatusCode.InternalServerError);
          }
        }
        await doRender(req, res);
      }
      next();
    });
  }
  const get: RouterFn = (...args) => use('get', ...args);
  const post: RouterFn = (...args) => use('post', ...args);

  const subdomain = (page: RouteHandler, params: (subdomain: string) => { [param: string]: string }): RouteHandler => {
    return async (req, res) => {
      let subdomain = req.headers['x-subdomain'];
      if (subdomain instanceof Array) {
        subdomain = subdomain[0];
      }
      if (subdomain) {
        req.params = { ...req.params, ...params(subdomain) };
      }
      await page(req, res);
    };
  };

  const renderContext = (context: RouteHandler, callback: (getFn: RouterFn, postFn: RouterFn) => void): void => {
    const _use = (method: Method, path: string, site: SiteCheck, middleware: Handler[], handler: RouteHandler) => {
      use(method, path, site, middleware, async (req, res) => {
        await handler(req, res);
        await context(req, res);
      });
    };

    callback(_use.bind(null, 'get'), _use.bind(null, 'post'));
  };

  // TEMPORARY redirect
  get('/help/markdown', sites.ALL, [], async (_, res) => {
    res.redirect('https://github.com/HMI-Studios/archivium/wiki/Markdown-Guide');
  });

  get('/', sites.NORMAL, [], pages.misc.home);

  /* Terms and Agreements */
  get('/privacy-policy', sites.ALL, [], pages.misc.privacyPolicy);
  get('/terms-of-service', sites.ALL, [], pages.misc.termsOfService);
  get('/code-of-conduct', sites.ALL, [], pages.misc.codeOfConduct);

  /* User Pages */
  get('/contacts', sites.ALL, [Auth.verifySessionOrRedirect], pages.user.contactList);
  get('/users/:username', sites.ALL, [], pages.user.profilePage);
  get('/settings', sites.ALL, [Auth.bypassEmailVerification, Auth.verifySessionOrRedirect], pages.user.settings);
  get('/verify', sites.ALL, [], pages.user.requestVerify);
  get('/verify/:key', sites.ALL, [], pages.user.verifyUser);
  get('/notifications', sites.ALL, [Auth.verifySessionOrRedirect], pages.user.notifications);
  get('/forgot-password', sites.ALL, [], (_, res) => res.prepareRender('forgotPassword'));
  get('/reset-password/:key', sites.ALL, [], (_, res) => res.prepareRender('resetPassword'));

  /* Misc pages */
  get('/search', sites.ALL, [], pages.misc.search);
  get('/news', sites.ALL, [], async (req, res) => {
    req.params.universeShortname = 'archivium';
    req.query.type = 'newsletter';
    req.query.sort = 'created_at';
    req.headers['x-subdomain'] = 'news';
    await pages.universe.itemList(req, res);
  });
  get('/news/:itemShortname', sites.ALL, [], async (req, res) => {
    req.params.universeShortname = 'archivium';
    req.headers['x-subdomain'] = 'news';
    await pages.item.view(req, res);
  });

  /* Note pages */
  get('/notes', sites.ALL, [Auth.verifySessionOrRedirect], pages.misc.notes);

  /* Story pages */
  get('/stories', sites.ALL, [], pages.story.list);
  get('/stories/create', sites.ALL, [Auth.verifySessionOrRedirect], pages.story.create);
  get('/stories/:shortname', sites.ALL, [], pages.story.view);
  get('/stories/:shortname/edit', sites.ALL, [Auth.verifySessionOrRedirect], pages.story.edit);
  get('/stories/:shortname/delete', sites.ALL, [Auth.verifySessionOrRedirect], pages.story.delete);
  get('/stories/:shortname/create', sites.ALL, [Auth.verifySessionOrRedirect], pages.story.createChapter);
  get('/stories/:shortname/:index', sites.ALL, [], pages.story.viewChapter);
  get('/stories/:shortname/:index/delete', sites.ALL, [Auth.verifySessionOrRedirect], pages.story.deleteChapter);

  get('/items', sites.NORMAL, [], pages.item.list);

  renderContext((req, res) => {
    if (res.templateData?.data?.universe) {
      const universe = res.templateData.data.universe;
      if (universe.tier < tiers.PREMIUM) return;
      const themeName = universe.obj_data.theme;
      const customTheme = universe.obj_data.customTheme ?? {};
      const baseTheme = themes[themeName] ?? req.theme;
      req.theme = themeName === 'custom' ? customTheme : baseTheme;
    }
  }, (get, post) => {
    get('/editor', sites.ALL, [Auth.verifySessionOrRedirect], pages.misc.editor);
    get('/editor/*', sites.ALL, [Auth.verifySessionOrRedirect], pages.misc.editor);

    /* Universe Pages */
    get('/universes', sites.NORMAL, [], pages.universe.list);
    get('/universes/create', sites.NORMAL, [Auth.verifySessionOrRedirect], pages.universe.create);
    get('/universes/:universeShortname', sites.NORMAL, [], pages.universe.view);
    get('/universes/:universeShortname/edit', sites.NORMAL, [Auth.verifySessionOrRedirect], pages.universe.edit);
    get('/universes/:universeShortname/delete', sites.NORMAL, [Auth.verifySessionOrRedirect], pages.universe.delete);
    get('/universes/:universeShortname/discuss/create', sites.NORMAL, [Auth.verifySessionOrRedirect], pages.universe.createDiscussionThread);
    get('/universes/:universeShortname/discuss/:threadId', sites.NORMAL, [Auth.verifySessionOrRedirect], pages.universe.discussionThread);
    get('/universes/:universeShortname/items', sites.NORMAL, [], pages.universe.itemList);
    get('/universes/:universeShortname/upgrade', sites.NORMAL, [Auth.verifySessionOrRedirect], pages.universe.upgrade);
    get('/universes/:universeShortname/admin', sites.NORMAL, [Auth.verifySessionOrRedirect], pages.universe.admin);
    get('/universes/:universeShortname/stats', sites.NORMAL, [Auth.verifySessionOrRedirect], pages.universe.stats);

    /* Item Pages */
    get('/universes/:universeShortname/items/create', sites.NORMAL, [Auth.verifySessionOrRedirect], pages.item.create);
    get('/universes/:universeShortname/items/:itemShortname', sites.NORMAL, [], pages.item.view);
    get('/universes/:universeShortname/items/:itemShortname/delete', sites.NORMAL, [Auth.verifySessionOrRedirect], pages.item.delete);

    /* Display Mode Pages */
    get('/', sites.DISPLAY, [], subdomain(pages.universe.view, (sub) => ({ universeShortname: sub })));
    get('/delete', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(pages.universe.delete, (sub) => ({ universeShortname: sub })));
    get('/edit', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(pages.universe.edit, (sub) => ({ universeShortname: sub })));
    get('/discuss/create', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(pages.universe.createDiscussionThread, (sub) => ({ universeShortname: sub })));
    get('/discuss/:threadId', sites.DISPLAY, [], subdomain(pages.universe.discussionThread, (sub) => ({ universeShortname: sub })));
    get('/upgrade', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(pages.universe.upgrade, (sub) => ({ universeShortname: sub })));
    get('/admin', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(pages.universe.admin, (sub) => ({ universeShortname: sub })));
    get('/stats', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(pages.universe.stats, (sub) => ({ universeShortname: sub })));

    get('/items', sites.DISPLAY, [], subdomain(pages.universe.itemList, (sub) => ({ universeShortname: sub })));
    get('/items/create', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(pages.item.create, (sub) => ({ universeShortname: sub })));
    get('/items/:itemShortname', sites.DISPLAY, [], subdomain(pages.item.view, (sub) => ({ universeShortname: sub })));
    get('/items/:itemShortname/delete', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(pages.item.delete, (sub) => ({ universeShortname: sub })));

    /* Universe POST Handlers */
    post('/universes/:universeShortname/edit', sites.NORMAL, [Auth.verifySessionOrRedirect], forms.editUniverse);
    post('/universes/:universeShortname/discuss/create', sites.NORMAL, [Auth.verifySessionOrRedirect], forms.createUniverseThread);
    post('/universes/:universeShortname/discuss/:threadId/comment', sites.NORMAL, [Auth.verifySessionOrRedirect], forms.commentOnThread);
    post('/universes/:universeShortname/upgrade', sites.NORMAL, [Auth.verifySessionOrRedirect], forms.sponsorUniverse);
    post('/universes/:universeShortname/items/create', sites.NORMAL, [Auth.verifySessionOrRedirect], forms.createItem);
    post('/universes/:universeShortname/items/:itemShortname/edit', sites.NORMAL, [Auth.verifySessionOrRedirect], () => { throw new RequestError('This endpoint is deprecared.', { code: HttpStatusCode.Gone }) });
    post('/universes/:universeShortname/items/:itemShortname/comment', sites.NORMAL, [Auth.verifySessionOrRedirect], forms.commentOnItem);

    post('/edit', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(forms.editUniverse, (sub) => ({ universeShortname: sub })));
    post('/discuss/create', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(forms.createUniverseThread, (sub) => ({ universeShortname: sub })));
    post('/discuss/:threadId/comment', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(forms.commentOnThread, (sub) => ({ universeShortname: sub })));
    post('/upgrade', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(forms.sponsorUniverse, (sub) => ({ universeShortname: sub })));
    post('/items/create', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(forms.createItem, (sub) => ({ universeShortname: sub })));
    post('/items/:itemShortname/edit', sites.DISPLAY, [Auth.verifySessionOrRedirect], () => { throw new RequestError('This endpoint is deprecared.', { code: HttpStatusCode.Gone }) });
    post('/items/:itemShortname/comment', sites.DISPLAY, [Auth.verifySessionOrRedirect], subdomain(forms.commentOnItem, (sub) => ({ universeShortname: sub })));
  });

  // Redirect (for notification links)
  get('/universes/:universeShortname*', sites.DISPLAY, [], (req, res) => {
    res.redirect(`${universeLink(req, req.params.universeShortname)}${req.params[0] || '/'}`);
  });

  /* POST Handlers */
  post('/settings/notifications', sites.ALL, [Auth.verifySessionOrRedirect], forms.notificationSettings);
  post('/forgot-password', sites.ALL, [ReCaptcha.verifyReCaptcha], forms.passwordResetRequest);
  post('/reset-password/:key', sites.ALL, [], forms.resetPassword);
  post('/notes/create', sites.ALL, [Auth.verifySessionOrRedirect], forms.createNote);
  post('/notes/edit', sites.ALL, [Auth.verifySessionOrRedirect], forms.editNote);
  post('/stories/create', sites.ALL, [Auth.verifySessionOrRedirect], forms.createStory);
  post('/stories/:shortname/edit', sites.ALL, [Auth.verifySessionOrRedirect], forms.editStory);
  post('/stories/:shortname/:index/comment', sites.ALL, [Auth.verifySessionOrRedirect], forms.commentOnChapter);
  post('/universes/create', sites.NORMAL, [Auth.verifySessionOrRedirect], forms.createUniverse);
}
