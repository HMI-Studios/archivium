UPDATE schema_version SET version = 21, comment = 'Add story covers', time = NOW();

CREATE TABLE storyimage (
  story_id INT NOT NULL,
  image_id INT NOT NULL,
  FOREIGN KEY (story_id) REFERENCES story (id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES image (id) ON DELETE CASCADE
);
