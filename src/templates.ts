import { Request } from 'express';
import pug from 'pug';
import api from './api';
import { getPfpUrl, handleAsNull, perms, plans, tierAllowance, tiers } from './api/utils';
import { ADDR_PREFIX, DOMAIN, PROVIDER_ADDRESS, VAPID_PUBLIC_KEY } from './config';
import { ForbiddenError, NotFoundError, UnauthorizedError } from './errors';
import { lang, locale, sprintf, T } from './locale';
import logger from './logger';
import themes from './themes';
import { Universe } from './api/models/universe';

export function universeLink(req: Request, uniShort) {
  const displayUniverse = req.headers['x-subdomain'];
  if (displayUniverse) {
    if (displayUniverse === uniShort) return ADDR_PREFIX;
    else return `https://${DOMAIN}${ADDR_PREFIX}/universes/${uniShort}`;
  } else {
    return `${ADDR_PREFIX}/universes/${uniShort}`;
  }
}

export const systemDisplayModes = ['news'];

// Basic context information to be sent to the templates
async function contextData(req: Request) {
  const user = req.session.user;
  const contextUser = user ? {
    id: user.id,
    username: user.username,
    notifications: user.notifications,
    plan: user.plan ?? plans.FREE,
    pfpUrl: getPfpUrl(user),
    maxTier: Math.max(...Object.keys(tierAllowance[user.plan ?? plans.FREE] || {}).filter(k => k !== 'total').map(k => Number(k))),
  } : null;

  const searchQueries = new URLSearchParams(req.query as Record<string, string>);
  const pageQuery = new URLSearchParams();
  pageQuery.append('page', req.path);
  if (searchQueries.toString()) pageQuery.append('search', searchQueries.toString());

  const displayUniverse = req.headers['x-subdomain'];
  let contextUniverse: Universe | null = null;
  if (displayUniverse) {
    contextUniverse = await api.universe.getOne(user, { 'universe.shortname': displayUniverse })
      .catch(handleAsNull([NotFoundError, UnauthorizedError, ForbiddenError]));
  }

  return {
    contextUser,
    contextUniverse,
    DOMAIN,
    ADDR_PREFIX,
    VAPID_PUBLIC_KEY,
    PROVIDER_ADDRESS,
    encodedPath: pageQuery.toString(),
    displayUniverse,
    systemDisplayModes,
    universeLink: universeLink.bind(null, req),
    searchQueries: searchQueries.toString(),
    perms,
    locale: locale[lang],
    themes,
    theme: req.theme ?? themes.default,
    plans,
    tiers,
    tierAllowance,
    T,
    sprintf,
    validateUsername: api.user.validateUsername,
    validateShortname: api.universe.validateShortname,
  };
}

const pugOptions = {
  basedir: __dirname,
};

function compile(file) {
  return pug.compileFile(file, pugOptions);
}

// compile templates
logger.info('Compiling templates...');
const templates = {
  error: compile('templates/error.pug'),
  docs: compile('templates/displayMd.pug'),
  home: compile('templates/home.pug'),
  login: compile('templates/login.pug'),
  signup: compile('templates/signup.pug'),

  universe: compile('templates/view/universe.pug'),
  editUniverse: compile('templates/edit/universe.pug'),
  deleteUniverse: compile('templates/delete/universe.pug'),
  universeList: compile('templates/list/universes.pug'),
  createUniverse: compile('templates/create/universe.pug'),
  upgradeUniverse: compile('templates/edit/universeUpgrade.pug'),
  privateUniverse: compile('templates/view/privateUniverse.pug'),
  universeAdmin: compile('templates/edit/universeAdmin.pug'),
  universeStats: compile('templates/edit/universeStats.pug'),

  universeThread: compile('templates/view/universeThread.pug'),
  createUniverseThread: compile('templates/create/universeThread.pug'),

  story: compile('templates/view/story.pug'),
  editStory: compile('templates/edit/story.pug'),
  deleteStory: compile('templates/delete/story.pug'),
  storyList: compile('templates/list/stories.pug'),
  createStory: compile('templates/create/story.pug'),
  chapter: compile('templates/view/chapter.pug'),
  deleteChapter: compile('templates/delete/chapter.pug'),

  item: compile('templates/view/item.pug'),
  deleteItem: compile('templates/delete/item.pug'),
  itemList: compile('templates/list/items.pug'),
  createItem: compile('templates/create/item.pug'),

  universeItemList: compile('templates/list/universeItems.pug'),

  user: compile('templates/view/user.pug'),
  contactList: compile('templates/list/contacts.pug'),

  search: compile('templates/list/search.pug'),
  notes: compile('templates/list/notes.pug'),
  verify: compile('templates/verify.pug'),
  settings: compile('templates/edit/settings.pug'),
  spamblock: compile('templates/spamblock.pug'),
  notifications: compile('templates/view/notifications.pug'),
  forgotPassword: compile('templates/edit/forgotPassword.pug'),
  resetPassword: compile('templates/edit/resetPassword.pug'),

  editor: compile('templates/editor.pug'),
};

export async function render(req: Request, template, context = {}) {
  if (template in templates) return templates[template]({ ...context, ...(await contextData(req)), curTemplate: template });
  else return templates.error({
    code: 404,
    hint: `Template ${template} not found.`,
    ...(await contextData(req)),
    curTemplate: template,
  });
}
