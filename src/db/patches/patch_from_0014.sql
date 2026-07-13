UPDATE schema_version SET version = 15, comment = 'Add unique constraint to lineage', time = NOW();

ALTER TABLE lineage
ADD CONSTRAINT parent_child_id
UNIQUE(parent_id, child_id);
