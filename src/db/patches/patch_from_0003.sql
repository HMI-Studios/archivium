UPDATE schema_version SET version = 4, comment = 'Add link tracking', time = NOW();

CREATE TABLE itemlink (
  from_item INT NOT NULL,
  to_universe_short VARCHAR(64) NOT NULL,
  to_item_short VARCHAR(64) NOT NULL,
  href VARCHAR(130) NOT NULL,
  FOREIGN KEY (from_item) REFERENCES item (id)
);
