UPDATE schema_version SET version = 27, comment = 'Link sent notifications to their source comment', time = NOW();

ALTER TABLE sentnotification
  MODIFY COLUMN body TEXT,
  ADD COLUMN comment_id INT,
  ADD FOREIGN KEY (comment_id) REFERENCES comment (id) ON DELETE SET NULL;
