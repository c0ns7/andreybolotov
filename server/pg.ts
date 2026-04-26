import "./load-env";
import { Pool, types } from "pg";
import type { PoolConfig, QueryResultRow } from "pg";

/** OID INT8: без парсера node-pg отдаёт BIGINT как string — ломает строгие проверки и кэши с number-ключами. */
types.setTypeParser(20, (val) => {
  const n = Number(val);
  return Number.isSafeInteger(n) ? n : val;
});

function getPgConnectionString(): string {
  const direct = String(process.env.DATABASE_URL ?? "").trim();
  if (direct) return direct;
  const host = String(process.env.PGHOST ?? "127.0.0.1").trim();
  const port = Number(process.env.PGPORT ?? 5432);
  const user = String(process.env.PGUSER ?? "postgres").trim();
  const password = String(process.env.PGPASSWORD ?? "").trim();
  const database = String(process.env.PGDATABASE ?? "andreybolotov").trim();
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function buildPoolConfig(): PoolConfig {
  const connectionString = getPgConnectionString();
  const timeoutMs = Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 10_000);
  const cfg: PoolConfig = {
    connectionString,
    connectionTimeoutMillis: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000,
  };
  const sslFlag = String(process.env.PGSSLMODE ?? process.env.DATABASE_SSL ?? "")
    .trim()
    .toLowerCase();
  if (sslFlag === "require" || sslFlag === "true" || sslFlag === "1") {
    cfg.ssl = { rejectUnauthorized: false };
  }
  return cfg;
}

export const pgPool = new Pool(buildPoolConfig());

/** Сетевая/инфраструктурная недоступность Postgres (не «логическая» SQL-ошибка). */
export function isPgConnectivityError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { code?: string };
  const code = String(e?.code ?? "");
  if (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    code === "ECONNRESET" ||
    code === "EPIPE"
  ) {
    return true;
  }
  if (code.startsWith("08")) return true;
  return false;
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await pgPool.query<T>(text, values);
  return result.rows;
}

export async function pgQueryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T | undefined> {
  const result = await pgPool.query<T>(text, values);
  return result.rows[0];
}

export async function closePgPool(): Promise<void> {
  await pgPool.end();
}

export async function ensurePgRuntimeSchema(): Promise<void> {
  await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locality TEXT`);
}
