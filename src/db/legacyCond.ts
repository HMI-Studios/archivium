import { sql, RawBuilder } from 'kysely';
import { Cond } from '../api/utils';

// TODO goal is to not need these someday
export function toRawSql<T = unknown>(text: string, values: unknown[] = []): RawBuilder<T> {
  const parts = text.split('?');
  const strings = Object.assign([...parts], { raw: [...parts] }) as TemplateStringsArray;
  return sql<T>(strings, ...values);
}

export function condToRawSql(cond: Cond | null | undefined): RawBuilder<boolean> | null {
  if (!cond) return null;
  const [str, values] = cond.export();
  if (!str) return null;
  return toRawSql<boolean>(str, values.filter((val) => val !== undefined));
}
