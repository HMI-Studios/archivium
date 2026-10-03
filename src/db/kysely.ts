import { ControlledTransaction, Kysely, MysqlDialect } from 'kysely';
import { Pool } from 'mysql2/promise';
import rawPool from './index';
import { DB } from './schema-types';

const pool = rawPool as Pool;

export const kysely = new Kysely<DB>({
  dialect: new MysqlDialect({
    pool: pool.pool,
  }),
});

export type Trx = ControlledTransaction<DB>;
