require('dotenv').config();
const { spawnSync } = require('child_process');

const {
  ARCHIVIUM_DB_HOST,
  ARCHIVIUM_DB_USER,
  ARCHIVIUM_DB_PASSWORD,
  ARCHIVIUM_DB,
} = process.env;

const url = `mysql://${encodeURIComponent(ARCHIVIUM_DB_USER)}:${encodeURIComponent(ARCHIVIUM_DB_PASSWORD)}@${ARCHIVIUM_DB_HOST}:3306/${ARCHIVIUM_DB}`;

const result = spawnSync(
  'npx',
  ['kysely-codegen', '--config-file', '.kysely-codegen.json'],
  {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: url },
  },
);

process.exit(result.status ?? 1);
