UPDATE schema_version SET version = 2, comment = 'Allow password resets', time = NOW();

CREATE TABLE userpasswordreset (
  user_id INT NOT NULL,
  reset_key VARCHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id)
);
