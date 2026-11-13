UPDATE schema_version SET version = 30, comment = 'Add MCP write toggles and per-user OAuth grants', time = NOW();

ALTER TABLE universe ADD COLUMN mcp_items_write_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE universe ADD COLUMN mcp_notes_write_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE oauth_grant (
  user_id INT NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  PRIMARY KEY (user_id, client_id),
  FOREIGN KEY (client_id) REFERENCES oauth_client (client_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE oauth_grant_universe (
  user_id INT NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  universe_id INT NOT NULL,
  items_write BOOLEAN NOT NULL DEFAULT FALSE,
  notes_write BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, client_id, universe_id),
  FOREIGN KEY (user_id, client_id) REFERENCES oauth_grant (user_id, client_id) ON DELETE CASCADE,
  FOREIGN KEY (universe_id) REFERENCES universe (id) ON DELETE CASCADE
);

INSERT IGNORE INTO oauth_grant (user_id, client_id, created_at, updated_at)
SELECT user_id, client_id, NOW(), NOW() FROM oauth_access_token
UNION
SELECT user_id, client_id, NOW(), NOW() FROM oauth_refresh_token;
