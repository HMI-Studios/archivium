UPDATE schema_version SET version = 17, comment = 'Create unified image table', time = NOW();

CREATE TABLE image (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  mimetype VARCHAR(32) NOT NULL,
  data LONGBLOB NOT NULL
);

ALTER TABLE image
ADD COLUMN user_ref INT NOT NULL;

INSERT INTO image (name, mimetype, data, user_ref)
SELECT name, mimetype, data, user_id
FROM userimage;

ALTER TABLE userimage
ADD COLUMN image_id INT NOT NULL;

UPDATE userimage
INNER JOIN image ON userimage.user_id = image.user_ref
SET userimage.image_id = image.id;

ALTER TABLE userimage
ADD CONSTRAINT userimage_imagefk
FOREIGN KEY (image_id) REFERENCES image (id)
ON DELETE CASCADE;

ALTER TABLE image
DROP COLUMN user_ref;
ALTER TABLE userimage
DROP COLUMN name;
ALTER TABLE userimage
DROP COLUMN mimetype;
ALTER TABLE userimage
DROP COLUMN data;


ALTER TABLE image
ADD COLUMN itemimage_ref INT NOT NULL;

INSERT INTO image (name, mimetype, data, itemimage_ref)
SELECT name, mimetype, data, id
FROM itemimage;

ALTER TABLE itemimage
ADD COLUMN image_id INT NOT NULL;

UPDATE itemimage
INNER JOIN image ON itemimage.id = image.itemimage_ref
SET itemimage.image_id = image.id;

ALTER TABLE itemimage
ADD CONSTRAINT itemimage_imagefk
FOREIGN KEY (image_id) REFERENCES image (id)
ON DELETE CASCADE;

ALTER TABLE image
DROP COLUMN itemimage_ref;
ALTER TABLE itemimage
DROP COLUMN id;
ALTER TABLE itemimage
DROP COLUMN name;
ALTER TABLE itemimage
DROP COLUMN mimetype;
ALTER TABLE itemimage
DROP COLUMN data;
