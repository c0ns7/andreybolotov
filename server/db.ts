import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "app.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

/** Миграции для существующих БД */
function migrate() {
  const cols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "role")) {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      is_staff INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_support_user ON support_messages(user_id, created_at);
  `);
  const smCols = db.prepare(`PRAGMA table_info(support_messages)`).all() as { name: string }[];
  if (!smCols.some((c) => c.name === "read_by_staff_at")) {
    db.exec(`ALTER TABLE support_messages ADD COLUMN read_by_staff_at INTEGER`);
    db.exec(
      `UPDATE support_messages SET read_by_staff_at = created_at WHERE is_staff = 0`,
    );
  }
  const smCols2 = db.prepare(`PRAGMA table_info(support_messages)`).all() as { name: string }[];
  if (!smCols2.some((c) => c.name === "attachment_url")) {
    db.exec(`ALTER TABLE support_messages ADD COLUMN attachment_url TEXT`);
    db.exec(`ALTER TABLE support_messages ADD COLUMN attachment_name TEXT`);
    db.exec(`ALTER TABLE support_messages ADD COLUMN attachment_mime TEXT`);
  }
  db.prepare(`UPDATE users SET role = 'admin' WHERE lower(email) = ?`).run("c0ns7@bk.ru");

  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email))`,
    );
  } catch {
    /* при дубликатах email в старых данных индекс не создастся — проверка в коде остаётся */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS raffles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      cover_image_url TEXT NOT NULL DEFAULT '',
      price_rub INTEGER NOT NULL DEFAULT 0,
      ticket_count INTEGER NOT NULL DEFAULT 0,
      collection_url TEXT NOT NULL DEFAULT '',
      collection_recipient TEXT NOT NULL DEFAULT '',
      qr_image_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_raffles_sort ON raffles (sort_order, id DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS raffle_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raffle_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      bank TEXT,
      amount_rub INTEGER NOT NULL,
      ticket_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      reserved_until INTEGER NOT NULL,
      receipt_url TEXT,
      receipt_name TEXT,
      receipt_mime TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_ro_raffle ON raffle_orders(raffle_id);
    CREATE INDEX IF NOT EXISTS idx_ro_user ON raffle_orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_ro_status ON raffle_orders(status);

    CREATE TABLE IF NOT EXISTS raffle_ticket_holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raffle_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      ticket_number INTEGER NOT NULL,
      hold_status TEXT NOT NULL,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES raffle_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE (raffle_id, ticket_number)
    );
    CREATE INDEX IF NOT EXISTS idx_rth_raffle ON raffle_ticket_holds(raffle_id);
    CREATE INDEX IF NOT EXISTS idx_rth_order ON raffle_ticket_holds(order_id);
  `);

  const roCols = db.prepare(`PRAGMA table_info(raffle_orders)`).all() as { name: string }[];
  if (!roCols.some((c) => c.name === "reserve_extended_once")) {
    db.exec(`ALTER TABLE raffle_orders ADD COLUMN reserve_extended_once INTEGER NOT NULL DEFAULT 0`);
  }

  const rafCols = db.prepare(`PRAGMA table_info(raffles)`).all() as { name: string }[];
  if (!rafCols.some((c) => c.name === "wholesale_enabled")) {
    db.exec(`ALTER TABLE raffles ADD COLUMN wholesale_enabled INTEGER NOT NULL DEFAULT 0`);
  }
  if (!rafCols.some((c) => c.name === "old_price_rub")) {
    db.exec(`ALTER TABLE raffles ADD COLUMN old_price_rub INTEGER NOT NULL DEFAULT 0`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS raffle_wholesale_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raffle_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      user_slot_index INTEGER NOT NULL,
      wholesale_number INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE (raffle_id, user_id, user_slot_index),
      UNIQUE (raffle_id, wholesale_number)
    );
    CREATE INDEX IF NOT EXISTS idx_rwa_raffle ON raffle_wholesale_assignments(raffle_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens(expires_at);
  `);
}

migrate();

export type UserRow = {
  id: number;
  phone: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: number;
  role: string;
};

export function insertUser(
  phone: string,
  name: string,
  email: string,
  passwordHash: string,
): number {
  const info = db
    .prepare(
      `INSERT INTO users (phone, name, email, password_hash, created_at, role)
       VALUES (@phone, @name, @email, @password_hash, @created_at, 'user')`,
    )
    .run({
      phone,
      name,
      email,
      password_hash: passwordHash,
      created_at: Date.now(),
    });
  return Number(info.lastInsertRowid);
}

export function getUserByPhone(phone: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone) as UserRow | undefined;
}

export function getUserByEmail(email: string): UserRow | undefined {
  const em = email.trim().toLowerCase();
  if (!em) return undefined;
  return db.prepare(`SELECT * FROM users WHERE lower(email) = ?`).get(em) as UserRow | undefined;
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

export function createSession(token: string, userId: number): void {
  db.prepare(`INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`).run(
    token,
    userId,
    Date.now(),
  );
}

export type SessionUser = {
  id: number;
  phone: string;
  name: string;
  email: string;
  role: string;
};

export function getUserBySessionToken(token: string): SessionUser | undefined {
  const row = db
    .prepare(
      `SELECT u.id AS id, u.phone AS phone, u.name AS name, u.email AS email,
              COALESCE(u.role, 'user') AS role
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as SessionUser | undefined;
  return row;
}

export function deleteSession(token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export type SupportMessageRow = {
  id: number;
  user_id: number;
  body: string;
  is_staff: number;
  created_at: number;
  read_by_staff_at: number | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
};

export function listSupportMessagesForUser(userId: number, limit = 200): SupportMessageRow[] {
  return db
    .prepare(
      `SELECT * FROM support_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT ?`,
    )
    .all(userId, limit) as SupportMessageRow[];
}

export function getSupportMessageById(id: number): SupportMessageRow | undefined {
  return db.prepare(`SELECT * FROM support_messages WHERE id = ?`).get(id) as
    | SupportMessageRow
    | undefined;
}

export function insertSupportMessage(
  userId: number,
  body: string,
  isStaff: boolean,
  attachment?: { url: string; name: string; mime: string } | null,
): number {
  const now = Date.now();
  const readAt = isStaff ? now : null;
  const att = attachment ?? null;
  const info = db
    .prepare(
      `INSERT INTO support_messages (user_id, body, is_staff, created_at, read_by_staff_at, attachment_url, attachment_name, attachment_mime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      body.trim(),
      isStaff ? 1 : 0,
      now,
      readAt,
      att?.url ?? null,
      att?.name ?? null,
      att?.mime ?? null,
    );
  return Number(info.lastInsertRowid);
}

export function markThreadReadByStaff(userId: number): void {
  const now = Date.now();
  db.prepare(
    `UPDATE support_messages SET read_by_staff_at = ? WHERE user_id = ? AND is_staff = 0`,
  ).run(now, userId);
}

export function messageToDto(r: SupportMessageRow) {
  const isStaff = r.is_staff === 1;
  return {
    id: r.id,
    body: r.body,
    is_staff: isStaff,
    created_at: r.created_at,
    /** Всегда boolean в JSON (undefined ломает клиент после JSON.stringify по WS) */
    read_by_staff: isStaff ? false : r.read_by_staff_at != null,
    attachment_url: r.attachment_url ?? null,
    attachment_name: r.attachment_name ?? null,
    attachment_mime: r.attachment_mime ?? null,
  };
}

export function updateUserProfile(
  id: number,
  data: { name: string; phone: string; email: string },
): void {
  db.prepare(`UPDATE users SET name = ?, phone = ?, email = ? WHERE id = ?`).run(
    data.name,
    data.phone,
    data.email,
    id,
  );
}

export function updateUserPasswordHash(userId: number, passwordHash: string): void {
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, userId);
}

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export function cleanupExpiredPasswordResetTokens(): void {
  const now = Date.now();
  db.prepare(`DELETE FROM password_reset_tokens WHERE expires_at < ?`).run(now);
}

export function setPasswordResetTokenForUser(
  userId: number,
  tokenHash: string,
  expiresAt: number,
): void {
  cleanupExpiredPasswordResetTokens();
  db.prepare(`DELETE FROM password_reset_tokens WHERE user_id = ?`).run(userId);
  db.prepare(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(userId, tokenHash, expiresAt, Date.now());
}

/** Одноразовое использование: удаляет строку и возвращает user_id, если токен валиден. */
export function consumePasswordResetToken(tokenHash: string): number | null {
  cleanupExpiredPasswordResetTokens();
  const now = Date.now();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?`,
      )
      .get(tokenHash, now) as { id: number; user_id: number } | undefined;
    if (!row) return null;
    db.prepare(`DELETE FROM password_reset_tokens WHERE id = ?`).run(row.id);
    return row.user_id;
  });
  return tx();
}

export { PASSWORD_RESET_TTL_MS };

export type AdminThreadRow = {
  id: number;
  phone: string;
  name: string;
  email: string;
  role: string;
  last_body: string | null;
  last_at: number | null;
  last_is_staff: number | null;
  unread_count: number;
};

export type RaffleRow = {
  id: number;
  title: string;
  cover_image_url: string;
  price_rub: number;
  old_price_rub?: number;
  ticket_count: number;
  collection_url: string;
  collection_recipient: string;
  qr_image_url: string;
  status: string;
  sort_order: number;
  wholesale_enabled: number;
  created_at: number;
  updated_at: number;
};

export type RaffleDto = {
  id: number;
  title: string;
  cover_image_url: string;
  price_rub: number;
  old_price_rub: number | null;
  ticket_count: number;
  collection_url: string;
  collection_recipient: string;
  qr_image_url: string;
  status: "active" | "closed" | "paused";
  sort_order: number;
  wholesale_enabled: boolean;
};

export function raffleToDto(r: RaffleRow): RaffleDto {
  const st = r.status === "closed" || r.status === "paused" ? r.status : "active";
  const oldP = Number(r.old_price_rub ?? 0);
  return {
    id: r.id,
    title: r.title,
    cover_image_url: r.cover_image_url,
    price_rub: r.price_rub,
    old_price_rub: oldP > 0 ? oldP : null,
    ticket_count: r.ticket_count,
    collection_url: r.collection_url,
    collection_recipient: r.collection_recipient,
    qr_image_url: r.qr_image_url,
    status: st,
    sort_order: r.sort_order,
    wholesale_enabled: Boolean((r as RaffleRow).wholesale_enabled),
  };
}

export function listRafflesAll(): RaffleRow[] {
  return db
    .prepare(`SELECT * FROM raffles ORDER BY sort_order ASC, id DESC`)
    .all() as RaffleRow[];
}

export function getRaffleById(id: number): RaffleRow | undefined {
  return db.prepare(`SELECT * FROM raffles WHERE id = ?`).get(id) as RaffleRow | undefined;
}

export function insertRaffle(data: {
  title: string;
  cover_image_url: string;
  price_rub: number;
  old_price_rub: number;
  ticket_count: number;
  collection_url: string;
  collection_recipient: string;
  qr_image_url: string;
  status: string;
  sort_order: number;
  wholesale_enabled: number;
}): number {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO raffles (
        title, cover_image_url, price_rub, old_price_rub, ticket_count,
        collection_url, collection_recipient, qr_image_url,
        status, sort_order, wholesale_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.title,
      data.cover_image_url,
      data.price_rub,
      data.old_price_rub,
      data.ticket_count,
      data.collection_url,
      data.collection_recipient,
      data.qr_image_url,
      data.status,
      data.sort_order,
      data.wholesale_enabled,
      now,
      now,
    );
  return Number(info.lastInsertRowid);
}

export function updateRaffle(
  id: number,
  data: {
    title: string;
    cover_image_url: string;
    price_rub: number;
    old_price_rub: number;
    ticket_count: number;
    collection_url: string;
    collection_recipient: string;
    qr_image_url: string;
    status: string;
    sort_order: number;
    wholesale_enabled: number;
  },
): void {
  db.prepare(
    `UPDATE raffles SET
      title = ?, cover_image_url = ?, price_rub = ?, old_price_rub = ?, ticket_count = ?,
      collection_url = ?, collection_recipient = ?, qr_image_url = ?,
      status = ?, sort_order = ?, wholesale_enabled = ?, updated_at = ?
    WHERE id = ?`,
  ).run(
    data.title,
    data.cover_image_url,
    data.price_rub,
    data.old_price_rub,
    data.ticket_count,
    data.collection_url,
    data.collection_recipient,
    data.qr_image_url,
    data.status,
    data.sort_order,
    data.wholesale_enabled,
    Date.now(),
    id,
  );
}

export function deleteRaffle(id: number): void {
  db.prepare(`DELETE FROM raffles WHERE id = ?`).run(id);
}

export function listAdminThreadsWithMeta(): AdminThreadRow[] {
  return db
    .prepare(
      `SELECT u.id, u.phone, u.name, u.email, COALESCE(u.role,'user') AS role,
              (SELECT CASE
                WHEN TRIM(COALESCE(sm.body,'')) != '' THEN sm.body
                WHEN sm.attachment_url IS NOT NULL THEN '📎 Вложение'
                ELSE COALESCE(sm.body,'')
              END FROM support_messages sm WHERE sm.user_id = u.id ORDER BY sm.created_at DESC LIMIT 1) AS last_body,
              (SELECT created_at FROM support_messages sm2 WHERE sm2.user_id = u.id ORDER BY sm2.created_at DESC LIMIT 1) AS last_at,
              (SELECT is_staff FROM support_messages sm3 WHERE sm3.user_id = u.id ORDER BY sm3.created_at DESC LIMIT 1) AS last_is_staff,
              (SELECT COUNT(*) FROM support_messages smu WHERE smu.user_id = u.id AND smu.is_staff = 0 AND smu.read_by_staff_at IS NULL) AS unread_count
       FROM users u
       WHERE EXISTS (SELECT 1 FROM support_messages smx WHERE smx.user_id = u.id)
       ORDER BY COALESCE(
         (SELECT MAX(created_at) FROM support_messages sm4 WHERE sm4.user_id = u.id),
         u.created_at
       ) DESC`,
    )
    .all() as AdminThreadRow[];
}
