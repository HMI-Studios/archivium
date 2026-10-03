UPDATE schema_version SET version = 29, comment = 'Tighten constraints', time = NOW();

ALTER TABLE note
  MODIFY COLUMN uuid VARCHAR(36) NOT NULL;

ALTER TABLE maplocation
  MODIFY COLUMN x DOUBLE NOT NULL,
  MODIFY COLUMN y DOUBLE NOT NULL;

ALTER TABLE universeaccessrequest
  MODIFY COLUMN is_invite BOOLEAN NOT NULL DEFAULT FALSE;
