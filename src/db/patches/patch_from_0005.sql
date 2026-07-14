UPDATE schema_version SET version = 6, comment = 'Upgrade universe authors to owner perms', time = NOW();

UPDATE authoruniverse AS au
INNER JOIN universe ON universe.id = au.universe_id AND universe.author_id = au.user_id
SET au.permission_level = 5;
