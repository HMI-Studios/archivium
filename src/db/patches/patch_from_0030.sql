UPDATE schema_version SET version = 31, comment = 'Add personal access tokens for MCP', time = NOW();

CREATE TABLE personal_access_token (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  client_id VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  token_hint VARCHAR(16) NOT NULL,
  expires_at TIMESTAMP NULL,
  last_used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (client_id) REFERENCES oauth_client (client_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);
