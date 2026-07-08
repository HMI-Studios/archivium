"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.API = void 0;
const contact_1 = require("./models/contact");
const discussion_1 = require("./models/discussion");
const email_1 = require("./models/email");
const image_1 = require("./models/image");
const item_1 = require("./models/item");
const note_1 = require("./models/note");
const notification_1 = require("./models/notification");
const oauth_1 = require("./models/oauth");
const session_1 = require("./models/session");
const story_1 = require("./models/story");
const universe_1 = require("./models/universe");
const user_1 = require("./models/user");
class API {
    contact;
    discussion;
    email;
    image;
    item;
    note;
    notification;
    oauth;
    session;
    story;
    universe;
    user;
    constructor() {
        this.contact = new contact_1.ContactAPI(this);
        this.discussion = new discussion_1.DiscussionAPI(this);
        this.email = new email_1.EmailAPI(this);
        this.image = new image_1.ImageAPI(this);
        this.item = new item_1.ItemAPI(this);
        this.note = new note_1.NoteAPI(this);
        this.notification = new notification_1.NotificationAPI(this);
        this.oauth = new oauth_1.OAuthAPI(this);
        this.session = new session_1.SessionAPI(this);
        this.story = new story_1.StoryAPI(this);
        this.universe = new universe_1.UniverseAPI(this);
        this.user = new user_1.UserAPI(this);
    }
}
exports.API = API;
const api = new API();
exports.default = api;
