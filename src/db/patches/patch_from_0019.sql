UPDATE schema_version SET version = 20, comment = 'Add map tables', time = NOW();

CREATE TABLE map (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  width SMALLINT,
  height SMALLINT,
  image_id INT,
  item_id INT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES item (id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES image (id)
);

CREATE TABLE maplocation (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  map_id INT NOT NULL,
  item_id INT,
  title VARCHAR(64),
  x DOUBLE,
  y DOUBLE,
  FOREIGN KEY (item_id) REFERENCES item (id),
  FOREIGN KEY (map_id) REFERENCES map (id) ON DELETE CASCADE
);
