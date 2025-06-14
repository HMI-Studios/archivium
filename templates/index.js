const pug = require('pug');
const { ADDR_PREFIX, VAPID_PUBLIC_KEY, DOMAIN } = require('../config');
const { perms, getPfpUrl } = require('../api/utils');
const { locale, lang, sprintf, T } = require('../locale');
const api = require('../api');
const path = require('path');

function universeLink(req, uniShort) {
  const displayUniverse = req.headers['x-subdomain'];
  if (displayUniverse) {
    if (displayUniverse === uniShort) return ADDR_PREFIX;
    else return `https://${DOMAIN}${ADDR_PREFIX}/universes/${uniShort}`;
  } else {
    return `${ADDR_PREFIX}/universes/${uniShort}`;
  }
}

// Basic context information to be sent to the templates
function contextData(req) {
  const user = req.session.user;
  const contextUser = user ? {
    id: user.id,
    username: user.username,
    notifications: user.notifications,
    pfpUrl: getPfpUrl(user),
  } : null;

  const searchQueries = new URLSearchParams(req.query);
  const pageQuery = new URLSearchParams();
  pageQuery.append('page', req.path)
  if (searchQueries.toString()) pageQuery.append('search', searchQueries.toString())

  return {
    contextUser,
    DOMAIN,
    ADDR_PREFIX,
    VAPID_PUBLIC_KEY,
    encodedPath: pageQuery.toString(),
    displayUniverse: req.headers['x-subdomain'],
    universeLink: universeLink.bind(null, req),
    searchQueries: searchQueries.toString(),
    perms,
    locale: locale[lang],
    T,
    sprintf,
    validateUsername: api.user.validateUsername,
    validateShortname: api.universe.validateShortname,
  };
}

const pugOptions = {
  basedir: path.join(__dirname, '..'),
};

function compile(file) {
  return pug.compileFile(file, pugOptions);
}

// compile templates
const templates = {
  error: compile('templates/error.pug'),
  docs: compile('templates/displayMd.pug'),
  home: compile('templates/home.pug'),
  login: compile('templates/login.pug'),
  signup: compile('templates/signup.pug'),
  markdownDemo: compile('templates/view/markdownDemo.pug'),

  universe: compile('templates/view/universe.pug'),
  editUniverse: compile('templates/edit/universe.pug'),
  deleteUniverse: compile('templates/delete/universe.pug'),
  universeList: compile('templates/list/universes.pug'),
  createUniverse: compile('templates/create/universe.pug'),
  editUniversePerms: compile('templates/edit/universePerms.pug'),
  privateUniverse: compile('templates/view/privateUniverse.pug'),

  universeThread: compile('templates/view/universeThread.pug'),
  createUniverseThread: compile('templates/create/universeThread.pug'),

  story: compile('templates/view/story.pug'),
  editStory: compile('templates/edit/story.pug'),
  deleteStory: compile('templates/delete/story.pug'),
  storyList: compile('templates/list/stories.pug'),
  createStory: compile('templates/create/story.pug'),
  chapter: compile('templates/view/chapter.pug'),
  editChapter: compile('templates/edit/chapter.pug'),
  deleteChapter: compile('templates/delete/chapter.pug'),

  item: compile('templates/view/item.pug'),
  editItem: compile('templates/edit/item.pug'),
  deleteItem: compile('templates/delete/item.pug'),
  itemList: compile('templates/list/items.pug'),
  createItem: compile('templates/create/item.pug'),

  universeItemList: compile('templates/list/universeItems.pug'),

  user: compile('templates/view/user.pug'),
  contactList: compile('templates/list/contacts.pug'),

  search: compile('templates/list/search.pug'),
  news: compile('templates/list/news.pug'),
  notes: compile('templates/list/notes.pug'),
  verify: compile('templates/verify.pug'),
  settings: compile('templates/edit/settings.pug'),
  spamblock: compile('templates/spamblock.pug'),
  notifications: compile('templates/view/notifications.pug'),
  forgotPassword: compile('templates/edit/forgotPassword.pug'),
  resetPassword: compile('templates/edit/resetPassword.pug'),
};

function render(req, template, context = {}) {
  if (template in templates) return templates[template]({ ...context, ...contextData(req), curTemplate: template });
  else return templates.error({
    code: 404,
    hint: `Template ${template} not found.`,
    ...contextData(req),
    curTemplate: template,
  });
}

module.exports = {
  render,
  universeLink,
  locale,
};
