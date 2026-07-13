UPDATE schema_version SET version = 3, comment = 'Add more notification settings', time = NOW();

CREATE TABLE threadnotification (
  thread_id INT NOT NULL,
  user_id INT NOT NULL,
  UNIQUE(thread_id, user_id),
  is_enabled BOOLEAN NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES discussion (id),
  FOREIGN KEY (user_id) REFERENCES user (id)
);

CREATE TABLE itemnotification (
  item_id INT NOT NULL,
  user_id INT NOT NULL,
  UNIQUE(item_id, user_id),
  is_enabled BOOLEAN NOT NULL,
  FOREIGN KEY (item_id) REFERENCES item (id),
  FOREIGN KEY (user_id) REFERENCES user (id)
);

INSERT INTO itemnotification (item_id, user_id, is_enabled)
SELECT id, author_id, TRUE
FROM item;
