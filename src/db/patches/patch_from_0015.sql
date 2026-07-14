UPDATE schema_version SET version = 16, comment = 'Make story chapter bodies JSON type', time = NOW();

ALTER TABLE storychapter
MODIFY COLUMN body JSON;
