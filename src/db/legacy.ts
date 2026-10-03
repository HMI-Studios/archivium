import { QueryResult, RowDataPacket } from 'mysql2/promise';
import db from '.';

export type SQLValue = number | string | boolean | Date | Buffer | null;

export async function executeQuery<T extends QueryResult = RowDataPacket[]>(query: string, values: SQLValue[] = []): Promise<T> {
  const [results] = await db.execute<T>(query, values);
  return results;
}
