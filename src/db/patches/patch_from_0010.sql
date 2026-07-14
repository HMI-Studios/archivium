UPDATE schema_version SET version = 11, comment = 'Don''t use NOW()', time = NOW();

ALTER TABLE story
ALTER COLUMN created_at DROP DEFAULT,
ALTER COLUMN updated_at DROP DEFAULT;

ALTER TABLE storychapter
ALTER COLUMN created_at DROP DEFAULT,
ALTER COLUMN updated_at DROP DEFAULT;
