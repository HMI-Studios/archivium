UPDATE schema_version SET version = 14, comment = 'Allow user custom theme, add premium beta plan', time = NOW();

ALTER TABLE user
ADD COLUMN custom_theme JSON DEFAULT NULL;

UPDATE userplan SET plan = 4 WHERE plan = 3;
