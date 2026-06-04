import type { PoolClient } from "pg";
import { pgPool, withPgRetry } from "./pg.js";

/** SQLite-стиль `?` → `$1`, `$2`, … (не использовать внутри строковых литералов с `?`). */
export function rewriteSqlPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

export async function pgAll<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  client?: PoolClient,
): Promise<T[]> {
  const text = rewriteSqlPlaceholders(sql);
  const runner = client ?? pgPool;
  const r = client
    ? await runner.query<T>(text, params)
    : await withPgRetry(() => runner.query<T>(text, params));
  return r.rows as T[];
}

export async function pgGet<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  client?: PoolClient,
): Promise<T | undefined> {
  const rows = await pgAll<T>(sql, params, client);
  return rows[0];
}

export async function pgExec(sql: string, params: unknown[] = [], client?: PoolClient): Promise<number> {
  const text = rewriteSqlPlaceholders(sql);
  const runner = client ?? pgPool;
  const r = client
    ? await runner.query(text, params)
    : await withPgRetry(() => runner.query(text, params));
  return r.rowCount ?? 0;
}
