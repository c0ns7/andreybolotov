import { createHash } from "node:crypto";
import { pgPool } from "../../server/pg";

type UserRow = {
  id: number;
  phone: string;
  name: string;
  email: string | null;
  password_hash: string;
  role: string;
  blocked: number;
  email_notify_chat?: number;
  email_notify_raffles?: number;
  email_notify_raffle_orders?: number;
};

export function normalizePhone(raw: string): string {
  const d = String(raw || "").replace(/\D+/g, "");
  if (!d) return "";
  if (d.length === 11 && d[0] === "8") return "7" + d.slice(1);
  if (d.length === 10 && d[0] === "9") return "7" + d;
  if (d.length === 11 && d[0] === "7") return d;
  return d;
}

export function isValidRuMobile(phone: string): boolean {
  return /^79\d{9}$/.test(String(phone || ""));
}

export async function getUserByPhone(phone: string): Promise<UserRow | undefined> {
  const r = await pgPool.query<UserRow>("SELECT * FROM users WHERE phone = $1 LIMIT 1", [phone]);
  return r.rows[0];
}

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  const r = await pgPool.query<UserRow>(
    "SELECT * FROM users WHERE lower(coalesce(email,'')) = lower($1) LIMIT 1",
    [email],
  );
  return r.rows[0];
}

export async function getUserById(id: number): Promise<UserRow | undefined> {
  const r = await pgPool.query<UserRow>("SELECT * FROM users WHERE id = $1 LIMIT 1", [id]);
  return r.rows[0];
}

export async function insertUser(
  phone: string,
  name: string,
  email: string | null,
  passwordHash: string,
): Promise<number> {
  const now = Date.now();
  const r = await pgPool.query<{ id: number }>(
    "INSERT INTO users (phone, name, email, password_hash, role, blocked, created_at) VALUES ($1, $2, $3, $4, 'user', 0, $5) RETURNING id",
    [phone, name, email, passwordHash, now],
  );
  return Number(r.rows[0]?.id ?? 0);
}

export async function createSession(token: string, userId: number): Promise<void> {
  const now = Date.now();
  await pgPool.query("INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)", [
    token,
    userId,
    now,
  ]);
}

export async function deleteSession(token: string): Promise<void> {
  await pgPool.query("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function getUserBySessionToken(token: string): Promise<UserRow | undefined> {
  const r = await pgPool.query<UserRow>(
    `SELECT u.* FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token = $1
     LIMIT 1`,
    [token],
  );
  return r.rows[0];
}

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export function hashPasswordResetToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export async function cleanupExpiredPasswordResetTokens(): Promise<void> {
  const now = Date.now();
  await pgPool.query("DELETE FROM password_reset_tokens WHERE expires_at < $1", [now]);
}

export async function setPasswordResetTokenForUser(
  userId: number,
  tokenHash: string,
  expiresAt: number,
): Promise<void> {
  await cleanupExpiredPasswordResetTokens();
  await pgPool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
  await pgPool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, expiresAt, Date.now()],
  );
}

/** Успешный сброс: удаляет токен и возвращает user_id, если токен ещё действителен. */
export async function consumePasswordResetToken(tokenHash: string): Promise<number | null> {
  await cleanupExpiredPasswordResetTokens();
  const now = Date.now();
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<{ id: number; user_id: number }>(
      "SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > $2 LIMIT 1",
      [tokenHash, now],
    );
    const row = r.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("DELETE FROM password_reset_tokens WHERE id = $1", [row.id]);
    await client.query("COMMIT");
    return Number(row.user_id);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function updateUserPasswordHash(userId: number, passwordHash: string): Promise<void> {
  await pgPool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, userId]);
}

process.on("beforeExit", async () => {
  try {
    await pgPool.end();
  } catch {
    /* noop */
  }
});
