UPDATE schema_version SET version = 26, comment = 'Add OAuth tables for MCP server authorization', time = NOW();

CREATE TABLE oauth_client (
  client_id VARCHAR(64) NOT NULL,
  client_secret VARCHAR(64),
  client_secret_expires_at INT,
  client_name VARCHAR(256),
  redirect_uris JSON NOT NULL,
  token_endpoint_auth_method VARCHAR(32),
  grant_types JSON,
  response_types JSON,
  scope VARCHAR(512),
  metadata JSON,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (client_id)
);

CREATE TABLE oauth_authorization_code (
  code VARCHAR(64) NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  user_id INT NOT NULL,
  redirect_uri VARCHAR(2048) NOT NULL,
  code_challenge VARCHAR(256) NOT NULL,
  scope VARCHAR(512),
  resource VARCHAR(2048),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (code),
  FOREIGN KEY (client_id) REFERENCES oauth_client (client_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE oauth_access_token (
  token VARCHAR(64) NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  user_id INT NOT NULL,
  scope VARCHAR(512),
  resource VARCHAR(2048),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (token),
  FOREIGN KEY (client_id) REFERENCES oauth_client (client_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE oauth_refresh_token (
  token VARCHAR(64) NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  user_id INT NOT NULL,
  scope VARCHAR(512),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (token),
  FOREIGN KEY (client_id) REFERENCES oauth_client (client_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);
