import { pgPool } from "./pg.js";

export type UserRow = {
  id: number;
  phone: string;
  name: string;
  email: string | null;
  locality?: string | null;
  password_hash: string;
  created_at: number;
  role: string;
  blocked: number;
  email_notify_chat?: number;
  email_notify_raffles?: number;
  email_notify_raffle_orders?: number;
  last_active_at?: number | null;
};

export type SessionUser = {
  id: number;
  phone: string;
  name: string;
  email: string | null;
  locality?: string | null;
  role: string;
  blocked: number;
};

const LAST_ACTIVE_WRITE_THROTTLE_MS = 60_000;
const lastActivityWriteAt = new Map<number, number>();

export async function insertUserPg(
  phone: string,
  name: string,
  email: string | null,
  locality: string | null,
  passwordHash: string,
): Promise<number> {
  const em =
    email != null && String(email).trim()
      ? String(email)
          .trim()
          .toLowerCase()
      : null;
  const loc =
    locality != null && String(locality).trim()
      ? String(locality)
          .trim()
          .slice(0, 120)
      : null;
  const now = Date.now();
  const r = await pgPool.query<{ id: number }>(
    `INSERT INTO users (phone, name, email, locality, password_hash, created_at, role)
     VALUES ($1, $2, $3, $4, $5, $6, 'user')
     RETURNING id`,
    [phone, name, em, loc, passwordHash, now],
  );
  return Number(r.rows[0]?.id ?? 0);
}

export async function getUserByPhonePg(phone: string): Promise<UserRow | undefined> {
  const r = await pgPool.query<UserRow>("SELECT * FROM users WHERE phone = $1 LIMIT 1", [phone]);
  return r.rows[0];
}

export async function getUserByEmailPg(email: string): Promise<UserRow | undefined> {
  const em = email.trim().toLowerCase();
  if (!em) return undefined;
  const r = await pgPool.query<UserRow>("SELECT * FROM users WHERE lower(email) = $1 LIMIT 1", [em]);
  return r.rows[0];
}

export async function getUserByIdPg(id: number): Promise<UserRow | undefined> {
  const r = await pgPool.query<UserRow>("SELECT * FROM users WHERE id = $1 LIMIT 1", [id]);
  return r.rows[0];
}

export async function createSessionPg(token: string, userId: number): Promise<void> {
  await pgPool.query("INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)", [
    token,
    userId,
    Date.now(),
  ]);
}

export async function deleteSessionPg(token: string): Promise<void> {
  await pgPool.query("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function getUserBySessionTokenPg(token: string): Promise<SessionUser | undefined> {
  const r = await pgPool.query<SessionUser>(
    `SELECT u.id AS id, u.phone AS phone, u.name AS name, u.email AS email, u.locality AS locality,
            COALESCE(u.role, 'user') AS role,
            COALESCE(u.blocked, 0) AS blocked
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token = $1
     LIMIT 1`,
    [token],
  );
  return r.rows[0];
}

export async function touchUserLastActivePg(userId: number): Promise<void> {
  const uid = Math.trunc(Number(userId));
  if (!Number.isInteger(uid) || uid <= 0) return;
  const now = Date.now();
  const lastWrite = lastActivityWriteAt.get(uid) ?? 0;
  if (now - lastWrite < LAST_ACTIVE_WRITE_THROTTLE_MS) return;
  await pgPool.query("UPDATE users SET last_active_at = $1 WHERE id = $2", [now, uid]);
  lastActivityWriteAt.set(uid, now);
}

export async function updateUserPasswordHashPg(userId: number, passwordHash: string): Promise<void> {
  await pgPool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, userId]);
}

export async function deletePasswordResetTokensForUserPg(userId: number): Promise<void> {
  await pgPool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
}

export async function updateUserLocalityPg(userId: number, locality: string): Promise<void> {
  const loc = String(locality).trim().slice(0, 120);
  await pgPool.query("UPDATE users SET locality = $1 WHERE id = $2", [loc || null, userId]);
}

export async function updateUserEmailNotifyPrefsPg(
  userId: number,
  prefs: {
    email_notify_chat?: boolean;
    email_notify_raffles?: boolean;
    email_notify_raffle_orders?: boolean;
  },
): Promise<void> {
  const parts: string[] = [];
  const vals: (number | string)[] = [];
  if (prefs.email_notify_chat !== undefined) {
    parts.push(`email_notify_chat = $${vals.length + 1}`);
    vals.push(prefs.email_notify_chat ? 1 : 0);
  }
  if (prefs.email_notify_raffles !== undefined) {
    parts.push(`email_notify_raffles = $${vals.length + 1}`);
    vals.push(prefs.email_notify_raffles ? 1 : 0);
  }
  if (prefs.email_notify_raffle_orders !== undefined) {
    parts.push(`email_notify_raffle_orders = $${vals.length + 1}`);
    vals.push(prefs.email_notify_raffle_orders ? 1 : 0);
  }
  if (!parts.length) return;
  vals.push(userId);
  await pgPool.query(`UPDATE users SET ${parts.join(", ")} WHERE id = $${vals.length}`, vals);
}

export const PASSWORD_RESET_TTL_MS_PG = 60 * 60 * 1000;

export async function cleanupExpiredPasswordResetTokensPg(): Promise<void> {
  await pgPool.query("DELETE FROM password_reset_tokens WHERE expires_at < $1", [Date.now()]);
}

export async function setPasswordResetTokenForUserPg(
  userId: number,
  tokenHash: string,
  expiresAt: number,
): Promise<void> {
  await cleanupExpiredPasswordResetTokensPg();
  await pgPool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
  await pgPool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, expiresAt, Date.now()],
  );
}

export async function consumePasswordResetTokenPg(tokenHash: string): Promise<number | null> {
  await cleanupExpiredPasswordResetTokensPg();
  const now = Date.now();
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const rowRes = await client.query<{ id: number; user_id: number }>(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND expires_at > $2
       LIMIT 1`,
      [tokenHash, now],
    );
    const row = rowRes.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("DELETE FROM password_reset_tokens WHERE id = $1", [row.id]);
    await client.query("COMMIT");
    return Number(row.user_id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
