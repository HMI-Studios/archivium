-- ARCHIVIUM DB
--

-- Schema version history
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  comment TEXT NOT NULL,
  time TIMESTAMP
);

INSERT INTO schema_version (version, comment, time)
VALUES (0, '', NULL);

CREATE TABLE newsletter (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(128),
  preview TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE user (
  id INT NOT NULL AUTO_INCREMENT,
  username VARCHAR(32) UNIQUE NOT NULL,
  email VARCHAR(64) UNIQUE NOT NULL,
  password VARCHAR(64) NOT NULL,
  salt VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  suspect BOOLEAN DEFAULT FALSE,
  email_notifications BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (id)
);

CREATE TABLE userimage (
  user_id INT NOT NULL,
  name VARCHAR(64) NOT NULL,
  mimetype VARCHAR(32) NOT NULL,
  data LONGBLOB NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE userverification (
  user_id INT NOT NULL,
  verification_key VARCHAR(64),
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE userpasswordreset (
  user_id INT NOT NULL,
  reset_key VARCHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE usernamechange (
  changed_for INT NOT NULL,
  changed_from VARCHAR(32) NOT NULL,
  changed_to VARCHAR(32) NOT NULL,
  changed_at TIMESTAMP NOT NULL,
  FOREIGN KEY (changed_for) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE userdeleterequest (
  user_id INT NOT NULL,
  requested_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE session (
  id INT NOT NULL AUTO_INCREMENT,
  hash VARCHAR(64) NOT NULL,
  user_id INT,
  created_at TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id),
  PRIMARY KEY (id)
);

CREATE TABLE contact (
  requesting_user INT NOT NULL,
  accepting_user INT NOT NULL,
  accepted BOOLEAN,
  FOREIGN KEY (requesting_user) REFERENCES user (id) ON DELETE CASCADE,
  FOREIGN KEY (accepting_user) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE universe (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(64) NOT NULL,
  shortname VARCHAR(64) UNIQUE NOT NULL,
  author_id INT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  public BOOLEAN NOT NULL,
  discussion_enabled BOOLEAN NOT NULL,
  discussion_open BOOLEAN NOT NULL,
  obj_data TEXT NOT NULL,
  FOREIGN KEY (author_id) REFERENCES user (id),
  PRIMARY KEY (id)
);

CREATE TABLE discussion (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(256) NOT NULL,
  universe_id INT NOT NULL,
  FOREIGN KEY (universe_id) REFERENCES universe (id) ON DELETE CASCADE
);

CREATE TABLE threadnotification (
  thread_id INT NOT NULL,
  user_id INT NOT NULL,
  UNIQUE(thread_id, user_id),
  is_enabled BOOLEAN NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES discussion (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE comment (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  body VARCHAR(2048),
  author_id INT,
  reply_to INT,
  created_at TIMESTAMP NOT NULL,
  FOREIGN KEY (author_id) REFERENCES user (id),
  FOREIGN KEY (reply_to) REFERENCES comment (id)
);

CREATE TABLE threadcomment (
  thread_id INT NOT NULL,
  comment_id INT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES discussion (id),
  FOREIGN KEY (comment_id) REFERENCES comment (id) ON DELETE CASCADE
);

CREATE TABLE note (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) UNIQUE,
  title VARCHAR(64),
  body TEXT NOT NULL,
  public BOOLEAN,
  author_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  FOREIGN KEY (author_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE noteboard (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(64) NOT NULL,
  shortname VARCHAR(64) UNIQUE NOT NULL,
  public BOOLEAN,
  universe_id INT NOT NULL,
  FOREIGN KEY (universe_id) REFERENCES universe (id) -- when boards are implemented we will either have to add on delete cascade here, OR make universe_id nullable
);

CREATE TABLE boardnote (
  note_id INT NOT NULL,
  board_id INT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES note (id),
  FOREIGN KEY (board_id) REFERENCES noteboard (id)
);

CREATE TABLE story (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(128) NOT NULL,
  shortname VARCHAR(64) UNIQUE NOT NULL,
  summary VARCHAR(2048),
  drafts_public BOOLEAN NOT NULL,
  author_id INT,
  universe_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  FOREIGN KEY (author_id) REFERENCES user (id),
  FOREIGN KEY (universe_id) REFERENCES universe (id) ON DELETE CASCADE
);

CREATE TABLE storychapter (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(128) NOT NULL,
  summary VARCHAR(2048),
  chapter_number INT NOT NULL,
  body TEXT NOT NULL,
  story_id INT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  FOREIGN KEY (story_id) REFERENCES story (id) ON DELETE CASCADE
);

CREATE TABLE storychaptercomment (
  chapter_id INT NOT NULL,
  comment_id INT NOT NULL,
  FOREIGN KEY (chapter_id) REFERENCES storychapter (id) ON DELETE CASCADE,
  FOREIGN KEY (comment_id) REFERENCES comment (id)
);

CREATE TABLE item (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(64) NOT NULL,
  shortname VARCHAR(64) NOT NULL,
  item_type VARCHAR(16) NOT NULL,
  author_id INT,
  universe_id INT NOT NULL,
  UNIQUE(shortname, universe_id),
  parent_id INT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  last_updated_by INT,
  obj_data TEXT NOT NULL,
  FOREIGN KEY (author_id) REFERENCES user (id),
  FOREIGN KEY (universe_id) REFERENCES universe (id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES item (id),
  FOREIGN KEY (last_updated_by) REFERENCES user (id),
  PRIMARY KEY (id)
);

CREATE TABLE itemnotification (
  item_id INT NOT NULL,
  user_id INT NOT NULL,
  UNIQUE(item_id, user_id),
  is_enabled BOOLEAN NOT NULL,
  FOREIGN KEY (item_id) REFERENCES item (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE itemcomment (
  item_id INT NOT NULL,
  comment_id INT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES item (id) ON DELETE CASCADE,
  FOREIGN KEY (comment_id) REFERENCES comment (id)
);

CREATE TABLE itemnote (
  item_id INT NOT NULL,
  note_id INT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES item (id) ON DELETE CASCADE,
  FOREIGN KEY (note_id) REFERENCES note (id) ON DELETE CASCADE
);

CREATE TABLE itemimage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL,
  name VARCHAR(64) NOT NULL,
  label VARCHAR(256) NOT NULL,
  mimetype VARCHAR(32) NOT NULL,
  data LONGBLOB NOT NULL,
  FOREIGN KEY (item_id) REFERENCES item (id) ON DELETE CASCADE
);

CREATE TABLE itemlink (
  from_item INT NOT NULL,
  to_universe_short VARCHAR(64) NOT NULL,
  to_item_short VARCHAR(64) NOT NULL,
  href VARCHAR(130) NOT NULL, -- This refers to the literal text in the text-body, i.e., for the link `[My Link](`universe/item`)`, `universe/item`. This is *not* guaranteed to be up-to-date with the shortnames of the universe and item.
  FOREIGN KEY (from_item) REFERENCES item (id) ON DELETE CASCADE
);

CREATE TABLE snooze (
  snoozed_at TIMESTAMP NOT NULL,
  snoozed_by INT NOT NULL,
  item_id INT NOT NULL,
  FOREIGN KEY (snoozed_by) REFERENCES user (id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES item (id) ON DELETE CASCADE
);

CREATE TABLE lineage (
  parent_id INT NOT NULL,
  child_id INT NOT NULL,
  parent_title VARCHAR(64),
  child_title VARCHAR(64),
  FOREIGN KEY (parent_id) REFERENCES item (id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES item (id) ON DELETE CASCADE
);

CREATE TABLE itemevent (
  id INT NOT NULL AUTO_INCREMENT,
  item_id INT NOT NULL,
  event_title VARCHAR(64),
  abstime BIGINT,
  UNIQUE(item_id, event_title),
  PRIMARY KEY (id),
  FOREIGN KEY (item_id) REFERENCES item (id) ON DELETE CASCADE
);
CREATE INDEX idx_abstime ON itemevent (abstime);

CREATE TABLE eventorder (
  former INT NOT NULL,
  latter INT NOT NULL,
  PRIMARY KEY (former, latter),
  FOREIGN KEY (former) REFERENCES itemevent (id) ON DELETE CASCADE,
  FOREIGN KEY (latter) REFERENCES itemevent (id) ON DELETE CASCADE
);

CREATE TABLE timelineitem (
  timeline_id INT NOT NULL,
  event_id INT NOT NULL,
  PRIMARY KEY (timeline_id, event_id),
  FOREIGN KEY (timeline_id) REFERENCES item (id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES itemevent (id) ON DELETE CASCADE
);

CREATE TABLE authoruniverse (
  id INT NOT NULL AUTO_INCREMENT,
  universe_id INT NOT NULL,
  user_id INT NOT NULL,
  permission_level TINYINT NOT NULL,
  FOREIGN KEY (universe_id) REFERENCES universe (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE,
  PRIMARY KEY (id)
);

CREATE TABLE universeaccessrequest (
  universe_id INT NOT NULL,
  user_id INT NOT NULL,
  permission_level TINYINT NOT NULL,
  FOREIGN KEY (universe_id) REFERENCES universe (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE followeruniverse (
  universe_id INT NOT NULL,
  user_id INT NOT NULL,
  is_following BOOLEAN NOT NULL,
  FOREIGN KEY (universe_id) REFERENCES universe (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE tag (
  item_id INT NOT NULL,
  tag VARCHAR(32),
  UNIQUE(item_id, tag),
  FOREIGN KEY (item_id) REFERENCES item (id) ON DELETE CASCADE
);

CREATE TABLE notetag (
  note_id INT NOT NULL,
  tag VARCHAR(32),
  UNIQUE(note_id, tag),
  FOREIGN KEY (note_id) REFERENCES note (id) ON DELETE CASCADE
);

CREATE TABLE sentemail (
  recipient VARCHAR(64) NOT NULL,
  topic VARCHAR(64) NOT NULL,
  sent_at TIMESTAMP NOT NULL
);

CREATE TABLE notificationsubscription (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  endpoint_hash CHAR(32) UNIQUE NOT NULL,
  push_endpoint TEXT NOT NULL,
  push_keys JSON NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE,
  PRIMARY KEY (id)
);

CREATE TABLE universenotification (
  universe_id INT NOT NULL,
  user_id INT NOT NULL,
  is_enabled BOOLEAN NOT NULL,
  FOREIGN KEY (universe_id) REFERENCES universe (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE notificationtype (
  user_id INT NOT NULL,
  notif_type VARCHAR(16) NOT NULL,
  notif_method TINYINT NOT NULL,
  is_enabled BOOLEAN NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE sentnotification (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(128),
  body TEXT NOT NULL,
  icon_url TEXT,
  click_url TEXT,
  notif_type VARCHAR(16) NOT NULL,
  user_id INT NOT NULL,
  sent_at TIMESTAMP NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);
