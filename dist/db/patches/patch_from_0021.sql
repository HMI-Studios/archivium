UPDATE schema_version SET version = 22, comment = 'Make note bodies JSON type', time = NOW();

ALTER TABLE note
MODIFY COLUMN body JSON;
