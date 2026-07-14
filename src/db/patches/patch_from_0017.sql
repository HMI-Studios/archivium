UPDATE schema_version SET version = 18, comment = 'Allow invites and add gallery index', time = NOW();

ALTER TABLE itemimage
ADD COLUMN idx INT NOT NULL;

ALTER TABLE universeaccessrequest
ADD COLUMN is_invite BOOLEAN DEFAULT FALSE;
ALTER TABLE universeaccessrequest
ADD COLUMN inviter_id INT;

ALTER TABLE universeaccessrequest
ADD CONSTRAINT universeaccessrequest_inviterfk
FOREIGN KEY (inviter_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE sentnotification
ADD dedup_key VARCHAR(128);
