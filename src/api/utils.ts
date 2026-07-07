import db from '../db';
import _ from 'lodash';
import md5 from 'md5';
import logger from '../logger';
import { Request, Response } from 'express';
import { PoolConnection, QueryResult, RowDataPacket } from 'mysql2/promise';
import { ForbiddenError, NotFoundError, RequestError } from '../errors';
import { User } from './models/user';

export enum perms {
  NONE,
  READ,
  COMMENT,
  WRITE,
  ADMIN,
  OWNER,
}

export enum plans {
  FREE,
  PREMIUM,
  BETA,
  PREMIUM_BETA,
  SUPER,
}

export const paidTiers = {
  PREMIUM: 1,
} as const;
type ValueOf<T> = T[keyof T];
export type PaidTier = ValueOf<typeof paidTiers>;

export const tiers = {
  FREE: 0,
  ...paidTiers,
} as const;
export type Tier = ValueOf<typeof tiers>;

export const tierAllowance: Record<plans, Record<PaidTier | 'total', number>> = {
  [plans.FREE]: { total: 5, [tiers.PREMIUM]: 0 },
  [plans.PREMIUM]: { total: 20, [tiers.PREMIUM]: 5 },
  [plans.BETA]: { total: 5, [tiers.PREMIUM]: 1 },
  [plans.PREMIUM_BETA]: { total: 20, [tiers.PREMIUM]: 5 },
  [plans.SUPER]: { total: 999, [tiers.PREMIUM]: 99  },
};

type TierLimit = {
  images: number, // image upload limit in bytes
};
export const tierLimits: Record<Tier, TierLimit> = {
  [tiers.FREE]: { images: 25_000_000 },
  [tiers.PREMIUM]: { images: 5_000_000_000 },
};

export type SQLValue = number | string | boolean | Date | null;
export async function executeQuery<T extends QueryResult = RowDataPacket[]>(query: string, values: SQLValue[] = [], conn?: PoolConnection): Promise<T> {
  const [ results ] = await (conn ?? db).execute<T>(query, values);
  return results;
}

export class RollbackError extends Error {}

export async function withTransaction(callback: (conn: PoolConnection) => Promise<void>) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    await callback(connection);

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    logger.warn('Transaction rolled back.');
    if (!(err instanceof RollbackError)) {
      throw err;
    }
  } finally {
    connection.release();
  }
}

export const parseData = (conditions: { [key: string]: any } | undefined | null) => {
  if (!conditions) return { strings: [], values: [] };
  const keys = Object.keys(conditions).filter(key => conditions[key] !== undefined);
  const values = keys.map(key => conditions[key]);
  const strings = keys.map(key => `${key as string} = ?`);
  return { strings, values };
}

export type BaseOptions = {
  search?: string;
  sort?: string;
  forceSort?: boolean;
  sortDesc?: boolean;
  limit?: number,
  groupBy?: string[],
  where?: Cond,
  select?: [string, string?, (string | string[])?][],
  join?: ['INNER' | 'LEFT' | 'RIGHT', string | [string, string], Cond?][]
};

export class QueryBuilder {
   table: string | null;
   selects: {};
   selectValues: {};
   joins: any[];
   whereCond: Cond | null;
   groups: {};
   order: any[];
   orderDesc: any[];
   resultLimit: number | null;
   unions: any[];

   constructor() {
    this.table = null;
    this.selects = {};
    this.selectValues = {};
    this.joins = [];
    this.whereCond = null;
    this.groups = {};
    this.order = [];
    this.orderDesc = [];
    this.resultLimit = null;
    this.unions = [];
   }

   select(col: string, selectAs: string | null = null, value: any | any[] = null) {
    this.selects[col] = selectAs;
    this.selectValues[col] = value;
    return this;
   }

   from(table) {
    this.table = table;
    return this;
   }

   join(type: 'INNER' | 'LEFT' | 'RIGHT', table: string | [string, string], on?: Cond) {
    this.joins.push([type, table, on]);
   }

   innerJoin(table, on) {
    this.join('INNER', table, on);
    return this;
   }

   leftJoin(table, on) {
    this.join('LEFT', table, on);
    return this;
   }

   where(cond) {
    if ((cond instanceof MultiCond || cond.check)) this.whereCond = cond;
    return this;
   }

   groupBy(col) {
    if (col instanceof Array) col.forEach(args => this.groupBy(args));
    else this.groups[col] = true;
    return this;
   }

   orderBy(col, orderDesc=false) {
    this.order.push(col);
    this.orderDesc.push(orderDesc);
    return this;
   }

   limit(l) {
    this.resultLimit = l;
    return this;
   }

   union(query) {
    this.unions.push(query);
    return this;
   }

   compile(): [string, any[]] {
    const selectCols = Object.keys(this.selects);
    let queryStr = '';
    let values: any[] = [];
    if (selectCols.length) {
      if (!this.table) throw 'No table specified!';
      queryStr += `SELECT ${selectCols.map(col => {
        if (this.selectValues[col]) {
          if (this.selectValues[col] instanceof Array) values = [...values, ...this.selectValues[col]];
          else values = [...values, this.selectValues[col]];
        }
        if (this.selects[col]) return `${col} AS ${this.selects[col]}`;
        else return col;
      }).join(', ')}`;
      queryStr += ` FROM ${this.table}`;
      for (const [type, table, on] of this.joins) {
        const tableStr = table instanceof Array ? table.join(' AS ') : table;
        queryStr += ` ${type} JOIN ${tableStr}`;
        if (on && on instanceof Cond) {
          const [str, vals] = on.export();
          queryStr += ` ON ${str}`;
          values = [...values, ...vals.filter(val => val !== undefined)];
        }
      }
      if (this.whereCond) {
        const [str, vals] = this.whereCond.export();
        queryStr += ` WHERE ${str}`;
        values = [...values, ...vals.filter(val => val !== undefined)];
      }
      const groupCols = Object.keys(this.groups);
      if (groupCols.length > 0) {
        queryStr += ` GROUP BY ${groupCols.join(', ')}`;
      }
      if (this.order.length) {
        const orderStr = this.order.map((col, i) => `${col} ${this.orderDesc[i] ? 'DESC' : 'ASC'}`);
        queryStr += ` ORDER BY ${orderStr}`;
      }
      if (this.resultLimit) {
        queryStr += ` LIMIT ${this.resultLimit}`;
      }
    } else if (this.unions.length) {
      const unionData = this.unions.map(query => query.compile());
      const strs: string[] = [];
      for (const [str, vals] of unionData) {
        strs.push(str);
        values = values.concat(vals);
      }
      queryStr += strs.join(' UNION ');
    }
    return [queryStr, values];
   }

   async execute() {
    const [queryStr, values] = this.compile();
    return await executeQuery(queryStr, values);
   }
}

export class Cond {
  check?: string;
  value?: any;
  constructor(check?: string, value?: any) {
    this.check = check;
    this.value = value;
  }

  or(cond?: string | Cond, value?) {
    if (!(cond instanceof Cond)) return this.or(new Cond(cond, value));
    if (cond && !(cond.check || cond instanceof MultiCond)) return this;
    if (this && !(this.check || this instanceof MultiCond)) return cond;
    return new MultiCond('OR', this, cond);
  }

  and(cond?: string | Cond, value?) {
    if (!(cond instanceof Cond)) return this.and(new Cond(cond, value));
    if (cond && !(cond.check || cond instanceof MultiCond)) return this;
    if (this && !(this.check || this instanceof MultiCond)) return cond;
    return new MultiCond('AND', this, cond);
  }

  export(): [string | undefined, any[]] {
    return [this.check, [this.value]];
  }
}

export type CondType = 'AND' | 'OR';

class MultiCond extends Cond {
  type: CondType;
  a: Cond;
  b: Cond;
  constructor(type: CondType, a: Cond, b: Cond) {
    super();
    this.type = type;
    this.a = a;
    this.b = b;
  }

  export(): [string, any[]] {
    const [aStr, aValues] = this.a.export();
    const [bStr, bValues] = this.b.export();
    if (!(aStr && bStr)) return [`${aStr || bStr || ''}`, [...aValues, ...bValues]];
    return [`(${aStr} ${this.type} ${bStr})`, [...aValues, ...bValues]];
  }
}

export function getPfpUrl(user: User) {
  return user.hasPfp ? `/api/users/${user.username}/pfp` : `https://www.gravatar.com/avatar/${md5(user.email ?? '')}.jpg`;
}

type CacheableImage = { mimetype: string, name: string, data?: Buffer };

export function sendCachedImage(req: Request, res: Response, image: CacheableImage | undefined, cacheKey: string | number, immutable: boolean): Buffer | undefined {
  if (!image) return undefined;
  res.contentType(image.mimetype);
  if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${image.name}"`);
  res.setHeader('ETag', `"img-${cacheKey}"`);
  res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (req.fresh) {
    res.status(304).end();
    return undefined;
  }
  return image.data;
}

export function handleAsNull(type: typeof RequestError | (typeof RequestError)[]) {
  if (type instanceof Array) {
    return (error: any): null => {
      if (type.some(t => error instanceof t)) {
        return null;
      }
      throw error;
    };
  } else {
    return (error: any): null => {
      if (error instanceof type) {
        return null;
      }
      throw error;
    };
  }
}

export function handleErrorWithData(error: any): null {
  if (error.data) {
    return error.data;
  }
  throw error;
}
