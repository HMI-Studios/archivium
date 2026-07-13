import { ContactAPI } from './models/contact';
import { DiscussionAPI } from './models/discussion';
import { EmailAPI } from './models/email';
import { ImageAPI } from './models/image';
import { ItemAPI } from './models/item';
import { NoteAPI } from './models/note';
import { NotificationAPI } from './models/notification';
import { OAuthAPI } from './models/oauth';
import { SessionAPI } from './models/session';
import { StoryAPI } from './models/story';
import { UniverseAPI } from './models/universe';
import { UserAPI } from './models/user';

export class API {
  readonly contact: ContactAPI;
  readonly discussion: DiscussionAPI;
  readonly email: EmailAPI;
  readonly image: ImageAPI;
  readonly item: ItemAPI;
  readonly note: NoteAPI;
  readonly notification: NotificationAPI;
  readonly oauth: OAuthAPI;
  readonly session: SessionAPI;
  readonly story: StoryAPI;
  readonly universe: UniverseAPI;
  readonly user: UserAPI;

  constructor() {
    this.contact = new ContactAPI(this);
    this.discussion = new DiscussionAPI(this);
    this.email = new EmailAPI(this);
    this.image = new ImageAPI(this);
    this.item = new ItemAPI(this);
    this.note = new NoteAPI(this);
    this.notification = new NotificationAPI(this);
    this.oauth = new OAuthAPI(this);
    this.session = new SessionAPI(this);
    this.story = new StoryAPI(this);
    this.universe = new UniverseAPI(this);
    this.user = new UserAPI(this);
  }
}

const api = new API();

export default api;
