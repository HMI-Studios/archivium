UPDATE schema_version SET version = 24, comment = 'Add image preview column for progressive loading', time = NOW();

ALTER TABLE image ADD COLUMN preview LONGBLOB;
