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
  const poolMax = Number(process.env.PG_POOL_MAX ?? 20);
  const idleMs = Number(process.env.PG_POOL_IDLE_MS ?? 20_000);
  const maxLifeSec = Number(process.env.PG_POOL_MAX_LIFETIME_SEC ?? 300);
  const cfg: PoolConfig = {
    connectionString,
    connectionTimeoutMillis: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000,
    max: Number.isFinite(poolMax) && poolMax > 0 ? Math.floor(poolMax) : 20,
    idleTimeoutMillis: Number.isFinite(idleMs) && idleMs > 0 ? Math.floor(idleMs) : 20_000,
    maxLifetimeSeconds:
      Number.isFinite(maxLifeSec) && maxLifeSec > 0 ? Math.floor(maxLifeSec) : 300,
    keepAlive: true,
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
  const e = err as NodeJS.ErrnoException & { code?: string; message?: string };
  const code = String(e?.code ?? "");
  const msg = String(e?.message ?? "").toLowerCase();
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
  if (code === "57P01" || code === "57P02" || code === "53300") return true;
  if (code.startsWith("08")) return true;
  if (
    msg.includes("connection terminated") ||
    msg.includes("connection closed") ||
    msg.includes("client was closed") ||
    msg.includes("cannot use a pool after calling end") ||
    msg.includes("socket hang up") ||
    msg.includes("server closed the connection")
  ) {
    return true;
  }
  return false;
}

const PG_RETRY_DELAY_MS = 120;

/** Повтор запроса при обрыве idle-соединения (типичная причина падения API). */
export async function withPgRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isPgConnectivityError(err)) throw err;
    await new Promise((r) => setTimeout(r, PG_RETRY_DELAY_MS));
    return await fn();
  }
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await withPgRetry(() => pgPool.query<T>(text, values));
  return result.rows;
}

export async function pgQueryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T | undefined> {
  const result = await withPgRetry(() => pgPool.query<T>(text, values));
  return result.rows[0];
}

export async function closePgPool(): Promise<void> {
  await pgPool.end();
}

export async function ensurePgRuntimeSchema(): Promise<void> {
  await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locality TEXT`);
  await pgPool.query(`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS cenopad_start_at BIGINT`);
  await pgPool.query(`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS cenopad_end_at BIGINT`);
  await pgPool.query(`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS live_stream_at BIGINT`);
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS live_stream_show_on_card INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS public_start_at BIGINT`);
  await pgPool.query(`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS live_stream_status TEXT NOT NULL DEFAULT 'scheduled'`);
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS promo_5_plus_2_enabled INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS promo_5_plus_2_locked_free_count INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS promo_10_plus_1_enabled INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS promo_10_plus_1_locked_free_count INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS promo_10_plus_2_enabled INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS promo_10_plus_2_locked_free_count INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(`ALTER TABLE raffle_ticket_holds ADD COLUMN IF NOT EXISTS bonus_promo_kind TEXT`);
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS wholesale_every_n_tickets INTEGER NOT NULL DEFAULT 10`,
  );
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS card_payment_scope TEXT NOT NULL DEFAULT 'unlimited'`,
  );
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS card_payment_min_tickets INTEGER NOT NULL DEFAULT 2`,
  );
  await pgPool.query(`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS cover_gif_url TEXT NOT NULL DEFAULT ''`);
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS hide_ticket_stats INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS sequential_batch_size INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS max_tickets_per_user INTEGER NOT NULL DEFAULT 25`,
  );
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS ticket_start_number INTEGER NOT NULL DEFAULT 1`,
  );
  await pgPool.query(
    `ALTER TABLE raffles ADD COLUMN IF NOT EXISTS max_tickets_per_user_total INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS raffle_bank_cards (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      raffle_id BIGINT NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      card_number TEXT NOT NULL,
      recipient TEXT NOT NULL,
      daily_max_orders INTEGER NOT NULL DEFAULT 0,
      disabled_until_ms BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_rbc_raffle ON raffle_bank_cards(raffle_id)`);
  await pgPool.query(`ALTER TABLE raffle_orders ADD COLUMN IF NOT EXISTS bank_card_id BIGINT`);
  await pgPool.query(`
    DO $$ BEGIN
      ALTER TABLE raffle_orders
        ADD CONSTRAINT raffle_orders_bank_card_id_fkey
        FOREIGN KEY (bank_card_id) REFERENCES raffle_bank_cards(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      body_html TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      cover_mime TEXT,
      keywords TEXT NOT NULL DEFAULT '',
      author_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      published_at BIGINT,
      view_count BIGINT NOT NULL DEFAULT 0,
      like_count BIGINT NOT NULL DEFAULT 0,
      comment_count BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_blog_posts_status_pub ON blog_posts(status, published_at DESC)`);
  await pgPool.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS pinned_at BIGINT`);
  await pgPool.query(
    `CREATE INDEX IF NOT EXISTS idx_blog_posts_pinned ON blog_posts(status, pinned_at DESC NULLS LAST)`,
  );
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS blog_tags (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS blog_post_tags (
      post_id BIGINT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      tag_id BIGINT NOT NULL REFERENCES blog_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, tag_id)
    )
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS blog_comments (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      parent_id BIGINT REFERENCES blog_comments(id) ON DELETE CASCADE,
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    )
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS blog_post_likes (
      post_id BIGINT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (post_id, user_id)
    )
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS blog_comment_likes (
      comment_id BIGINT NOT NULL REFERENCES blog_comments(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (comment_id, user_id)
    )
  `);
  await pgPool.query(
    `CREATE INDEX IF NOT EXISTS idx_blog_comment_likes_comment ON blog_comment_likes(comment_id)`,
  );
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS blog_post_views (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      viewer_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      viewed_at BIGINT NOT NULL
    )
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS blog_post_media (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      url TEXT NOT NULL,
      mime TEXT,
      created_at BIGINT NOT NULL
    )
  `);
  await pgPool.query(
    `CREATE INDEX IF NOT EXISTS idx_blog_post_media_post ON blog_post_media(post_id, sort_order)`,
  );
  await pgPool.query(`ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS blog_enabled INTEGER NOT NULL DEFAULT 0`);
  await pgPool.query(`ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS music_enabled INTEGER NOT NULL DEFAULT 0`);
  await pgPool.query(
    `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS music_default_volume INTEGER NOT NULL DEFAULT 35`,
  );
  await pgPool.query(
    `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS music_playback_mode TEXT NOT NULL DEFAULT 'sequential'`,
  );
  await pgPool.query(
    `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS support_max_url TEXT NOT NULL DEFAULT 'https://max.ru/u/f9LHodD0cOKSJihr4puAfiyfPGQJWImlRAdNuRhpYwI7qse5YaB625-1d3w'`,
  );
  await pgPool.query(
    `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS max_chat_join_url TEXT NOT NULL DEFAULT 'https://max.ru/join/_vIVZ3_FIwNimrGLFBwVEDWR408uZ3uynFc336CYX2k'`,
  );
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS site_music_tracks (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      file_url TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_site_music_tracks_sort ON site_music_tracks(sort_order, id)`);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS prize_awards (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      prize_type TEXT NOT NULL DEFAULT 'physical',
      status TEXT NOT NULL DEFAULT 'pending',
      claim_data TEXT NOT NULL DEFAULT '',
      admin_notes TEXT NOT NULL DEFAULT '',
      created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      claimed_at BIGINT,
      admin_marked_done_at BIGINT,
      transfer_receipt_url TEXT NOT NULL DEFAULT '',
      transfer_receipt_name TEXT NOT NULL DEFAULT '',
      transfer_receipt_mime TEXT NOT NULL DEFAULT '',
      review_requested INTEGER NOT NULL DEFAULT 0,
      review_received INTEGER NOT NULL DEFAULT 0,
      chat_message_id BIGINT
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_prize_awards_user ON prize_awards(user_id, created_at DESC)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_prize_awards_status ON prize_awards(status, updated_at DESC)`);
  await pgPool.query(
    `ALTER TABLE prize_awards ADD COLUMN IF NOT EXISTS raffle_id BIGINT REFERENCES raffles(id) ON DELETE SET NULL`,
  );
  await pgPool.query(
    `ALTER TABLE prize_awards ADD COLUMN IF NOT EXISTS money_amount_rub INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(
    `ALTER TABLE prize_awards ADD COLUMN IF NOT EXISTS exchange_ticket_count INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(
    `ALTER TABLE prize_awards ADD COLUMN IF NOT EXISTS allows_ticket_exchange INTEGER NOT NULL DEFAULT 0`,
  );
  await pgPool.query(`ALTER TABLE prize_awards ADD COLUMN IF NOT EXISTS ticket_number INTEGER`);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS user_ticket_swaps (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      raffle_id BIGINT NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
      from_ticket_number INTEGER NOT NULL,
      to_ticket_number INTEGER NOT NULL,
      order_id BIGINT NOT NULL REFERENCES raffle_orders(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    )
  `);
  await pgPool.query(
    `CREATE INDEX IF NOT EXISTS idx_uts_user_raffle_day ON user_ticket_swaps(user_id, raffle_id, created_at DESC)`,
  );

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS raffle_bonus_tables (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      raffle_id BIGINT NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      access_mode TEXT NOT NULL DEFAULT 'closed',
      view_privacy TEXT NOT NULL DEFAULT 'participants_admins',
      public_slug TEXT NOT NULL UNIQUE,
      start_at BIGINT NOT NULL,
      end_at BIGINT NOT NULL,
      count_from TEXT NOT NULL DEFAULT 'table_created',
      tickets_required INTEGER NOT NULL DEFAULT 2,
      bonus_slots_per_reward INTEGER NOT NULL DEFAULT 1,
      aggregation TEXT NOT NULL DEFAULT 'cumulative',
      period_scope TEXT NOT NULL DEFAULT 'same_day',
      status TEXT NOT NULL DEFAULT 'active',
      created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await pgPool.query(
    `CREATE INDEX IF NOT EXISTS idx_raffle_bonus_tables_raffle ON raffle_bonus_tables(raffle_id, status, start_at DESC)`,
  );
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS raffle_bonus_table_entries (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      bonus_table_id BIGINT NOT NULL REFERENCES raffle_bonus_tables(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_phone TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL,
      order_id BIGINT REFERENCES raffle_orders(id) ON DELETE SET NULL,
      qualifying_ticket_count INTEGER NOT NULL DEFAULT 0,
      qualifying_ticket_numbers TEXT NOT NULL DEFAULT '[]',
      chat_notified INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      UNIQUE(bonus_table_id, position)
    )
  `);
  await pgPool.query(
    `CREATE INDEX IF NOT EXISTS idx_raffle_bonus_entries_table ON raffle_bonus_table_entries(bonus_table_id, position)`,
  );
  await pgPool.query(
    `CREATE INDEX IF NOT EXISTS idx_raffle_bonus_entries_user ON raffle_bonus_table_entries(bonus_table_id, user_id)`,
  );
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS raffle_bonus_table_progress (
      bonus_table_id BIGINT NOT NULL REFERENCES raffle_bonus_tables(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL DEFAULT '',
      remainder_tickets INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bonus_table_id, user_id, period_key)
    )
  `);
}
