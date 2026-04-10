UPDATE schema_version SET version = 22, comment = 'Make note and universe bodies JSON type', time = NOW();

ALTER TABLE note
MODIFY COLUMN body JSON;

ALTER TABLE universe
MODIFY COLUMN obj_data JSON;
