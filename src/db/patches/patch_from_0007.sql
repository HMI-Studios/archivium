UPDATE schema_version SET version = 8, comment = 'Add user delete request table', time = NOW();

CREATE TABLE userdeleterequest (
  user_id INT NOT NULL,
  requested_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);
