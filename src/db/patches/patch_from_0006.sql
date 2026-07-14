UPDATE schema_version SET version = 7, comment = 'Make author and comment body fields nullable', time = NOW();

ALTER TABLE comment
MODIFY COLUMN body VARCHAR(2048),
MODIFY COLUMN author_id INT;

ALTER TABLE item
MODIFY COLUMN author_id INT;

ALTER TABLE universe
MODIFY COLUMN author_id INT;
