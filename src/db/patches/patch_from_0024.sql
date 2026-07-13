UPDATE schema_version SET version = 25, comment = 'Add per-universe MCP access toggles', time = NOW();

ALTER TABLE universe ADD COLUMN mcp_items_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE universe ADD COLUMN mcp_notes_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE universe ADD COLUMN mcp_discussions_enabled BOOLEAN NOT NULL DEFAULT FALSE;
