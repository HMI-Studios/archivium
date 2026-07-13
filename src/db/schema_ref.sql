-- ARCHIVIUM DB
--

-- Schema version history
CREATE TABLE schema_version (
  version INTEGER,
  comment TEXT NOT NULL,
  time TIMESTAMP
);

INSERT INTO schema_version (version, comment, time)
VALUES (0, '', NULL);

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
  FOREIGN KEY (user_id) REFERENCES user (id)
);

CREATE TABLE userverification (
  user_id INT NOT NULL,
  verification_key VARCHAR(64),
  FOREIGN KEY (user_id) REFERENCES user (id)
);

CREATE TABLE usernamechange (
  changed_for INT NOT NULL,
  changed_from VARCHAR(32) NOT NULL,
  changed_to VARCHAR(32) NOT NULL,
  changed_at TIMESTAMP NOT NULL,
  FOREIGN KEY (changed_for) REFERENCES user (id)
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
  FOREIGN KEY (requesting_user) REFERENCES user (id),
  FOREIGN KEY (accepting_user) REFERENCES user (id)
);

CREATE TABLE universe (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(64) NOT NULL,
  shortname VARCHAR(64) UNIQUE NOT NULL,
  author_id INT NOT NULL,
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
  FOREIGN KEY (universe_id) REFERENCES universe (id)
);

CREATE TABLE comment (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  body VARCHAR(2048) NOT NULL,
  author_id INT NOT NULL,
  reply_to INT,
  created_at TIMESTAMP NOT NULL,
  FOREIGN KEY (author_id) REFERENCES user (id),
  FOREIGN KEY (reply_to) REFERENCES comment (id)
);

CREATE TABLE threadcomment (
  thread_id INT NOT NULL,
  comment_id INT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES discussion (id),
  FOREIGN KEY (comment_id) REFERENCES comment (id)
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
  FOREIGN KEY (author_id) REFERENCES user (id)
);

CREATE TABLE noteboard (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(64) NOT NULL,
  shortname VARCHAR(64) UNIQUE NOT NULL,
  public BOOLEAN,
  universe_id INT NOT NULL,
  FOREIGN KEY (universe_id) REFERENCES universe (id)
);

CREATE TABLE boardnote (
  note_id INT NOT NULL,
  board_id INT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES note (id),
  FOREIGN KEY (board_id) REFERENCES noteboard (id)
);

CREATE TABLE item (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(64) NOT NULL,
  shortname VARCHAR(64) NOT NULL,
  item_type VARCHAR(16) NOT NULL,
  author_id INT NOT NULL,
  universe_id INT NOT NULL,
  UNIQUE(shortname, universe_id),
  parent_id INT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  last_updated_by INT,
  obj_data TEXT NOT NULL,
  FOREIGN KEY (author_id) REFERENCES user (id),
  FOREIGN KEY (universe_id) REFERENCES universe (id),
  FOREIGN KEY (parent_id) REFERENCES item (id),
  FOREIGN KEY (last_updated_by) REFERENCES user (id),
  PRIMARY KEY (id)
);

CREATE TABLE itemcomment (
  item_id INT NOT NULL,
  comment_id INT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES item (id),
  FOREIGN KEY (comment_id) REFERENCES comment (id)
);

CREATE TABLE itemnote (
  item_id INT NOT NULL,
  note_id INT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES item (id),
  FOREIGN KEY (note_id) REFERENCES note (id)
);

CREATE TABLE itemimage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL,
  name VARCHAR(64) NOT NULL,
  label VARCHAR(256) NOT NULL,
  mimetype VARCHAR(32) NOT NULL,
  data LONGBLOB NOT NULL,
  FOREIGN KEY (item_id) REFERENCES item (id)
);

CREATE TABLE snooze (
  snoozed_at TIMESTAMP NOT NULL,
  snoozed_by INT NOT NULL,
  item_id INT NOT NULL,
  FOREIGN KEY (snoozed_by) REFERENCES user (id),
  FOREIGN KEY (item_id) REFERENCES item (id)
);

CREATE TABLE lineage (
  parent_id INT NOT NULL,
  child_id INT NOT NULL,
  parent_title VARCHAR(64),
  child_title VARCHAR(64),
  FOREIGN KEY (parent_id) REFERENCES item (id),
  FOREIGN KEY (child_id) REFERENCES item (id)
);

CREATE TABLE itemevent (
  id INT NOT NULL AUTO_INCREMENT,
  item_id INT NOT NULL,
  event_title VARCHAR(64),
  abstime BIGINT,
  UNIQUE(item_id, event_title),
  PRIMARY KEY (id),
  FOREIGN KEY (item_id) REFERENCES item (id)
);
CREATE INDEX idx_abstime ON itemevent (abstime);

CREATE TABLE eventorder (
  former INT NOT NULL,
  latter INT NOT NULL,
  PRIMARY KEY (former, latter),
  FOREIGN KEY (former) REFERENCES itemevent (id),
  FOREIGN KEY (latter) REFERENCES itemevent (id)
);

CREATE TABLE timelineitem (
  timeline_id INT NOT NULL,
  event_id INT NOT NULL,
  PRIMARY KEY (timeline_id, event_id),
  FOREIGN KEY (timeline_id) REFERENCES item (id),
  FOREIGN KEY (event_id) REFERENCES itemevent (id)
);

CREATE TABLE authoruniverse (
  id INT NOT NULL AUTO_INCREMENT,
  universe_id INT NOT NULL,
  user_id INT NOT NULL,
  permission_level TINYINT NOT NULL,
  FOREIGN KEY (universe_id) REFERENCES universe (id),
  FOREIGN KEY (user_id) REFERENCES user (id),
  PRIMARY KEY (id)
);

CREATE TABLE universeaccessrequest (
  universe_id INT NOT NULL,
  user_id INT NOT NULL,
  permission_level TINYINT NOT NULL,
  FOREIGN KEY (universe_id) REFERENCES universe (id),
  FOREIGN KEY (user_id) REFERENCES user (id)
);

CREATE TABLE followeruniverse (
  universe_id INT NOT NULL,
  user_id INT NOT NULL,
  is_following BOOLEAN NOT NULL,
  FOREIGN KEY (universe_id) REFERENCES universe (id),
  FOREIGN KEY (user_id) REFERENCES user (id)
);

CREATE TABLE tag (
  item_id INT NOT NULL,
  tag VARCHAR(32),
  UNIQUE(item_id, tag),
  FOREIGN KEY (item_id) REFERENCES item (id)
);

CREATE TABLE notetag (
  note_id INT NOT NULL,
  tag VARCHAR(32),
  UNIQUE(note_id, tag),
  FOREIGN KEY (note_id) REFERENCES note (id)
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
  FOREIGN KEY (user_id) REFERENCES user (id),
  PRIMARY KEY (id)
);

CREATE TABLE universenotification (
  universe_id INT NOT NULL,
  user_id INT NOT NULL,
  is_enabled BOOLEAN NOT NULL,
  FOREIGN KEY (universe_id) REFERENCES universe (id),
  FOREIGN KEY (user_id) REFERENCES user (id)
);

CREATE TABLE notificationtype (
  user_id INT NOT NULL,
  notif_type VARCHAR(16) NOT NULL,
  notif_method TINYINT NOT NULL,
  is_enabled BOOLEAN NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id)
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
  FOREIGN KEY (user_id) REFERENCES user (id)
);
