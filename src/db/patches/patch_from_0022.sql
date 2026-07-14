UPDATE schema_version SET version = 23, comment = 'Add item chunk embeddings', time = NOW();

CREATE TABLE itemembeddedchunks (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  chunk_id VARCHAR(128) NOT NULL,
  item_id INT NOT NULL,
  scope VARCHAR(16) NOT NULL,
  heading_path TEXT,
  content TEXT,
  token_count INT,
  hash VARCHAR(64) NOT NULL,
  FOREIGN KEY (item_id) REFERENCES item (id) ON DELETE CASCADE
);
