UPDATE schema_version SET version = 12, comment = 'Add access tiers & user theme', time = NOW();

CREATE TABLE userplan (
  user_id INT NOT NULL,
  plan TINYINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE usersponsoreduniverse (
  user_id INT NOT NULL,
  universe_id INT UNIQUE NOT NULL,
  tier TINYINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE,
  FOREIGN KEY (universe_id) REFERENCES universe (id) ON DELETE CASCADE
);

ALTER TABLE user
ADD COLUMN preferred_theme VARCHAR(16);
