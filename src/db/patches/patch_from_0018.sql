UPDATE schema_version SET version = 19, comment = 'Drop newsletter table', time = NOW();

DROP TABLE newsletter;
