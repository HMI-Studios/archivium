UPDATE schema_version SET version = 9, comment = 'Add newsletter', time = NOW();

CREATE TABLE newsletter (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(128),
  preview TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);
