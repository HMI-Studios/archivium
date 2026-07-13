UPDATE schema_version SET version = 13, comment = 'Dont use reserved word "public"', time = NOW();

ALTER TABLE universe
ADD COLUMN is_public BOOLEAN NOT NULL;
ALTER TABLE note
ADD COLUMN is_public BOOLEAN;
ALTER TABLE noteboard
ADD COLUMN is_public BOOLEAN;

UPDATE universe SET is_public = public;
UPDATE note SET is_public = public;
UPDATE noteboard SET is_public = public;

ALTER TABLE universe
DROP COLUMN public;
ALTER TABLE note
DROP COLUMN public;
ALTER TABLE noteboard
DROP COLUMN public;
