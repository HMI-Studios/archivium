UPDATE schema_version SET version = 10, comment = 'Add stories', time = NOW();

CREATE TABLE story (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(128) NOT NULL,
  shortname VARCHAR(64) UNIQUE NOT NULL,
  summary VARCHAR(2048),
  drafts_public BOOLEAN NOT NULL,
  author_id INT,
  universe_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
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
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (story_id) REFERENCES story (id) ON DELETE CASCADE
);

CREATE TABLE storychaptercomment (
  chapter_id INT NOT NULL,
  comment_id INT NOT NULL,
  FOREIGN KEY (chapter_id) REFERENCES storychapter (id) ON DELETE CASCADE,
  FOREIGN KEY (comment_id) REFERENCES comment (id)
);
