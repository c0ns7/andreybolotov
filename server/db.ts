import { randomUUID } from "node:crypto";
import { raffleHashLookupCandidates } from "./ab-cdn-safe-token.js";
import { normalizePhone } from "./phone.js";
import {
  cleanupExpiredPasswordResetTokensPg,
  consumePasswordResetTokenPg,
  createSessionPg,
  deletePasswordResetTokensForUserPg,
  deleteSessionPg,
  getUserByEmailPg,
  getUserByIdPg,
  getUserByPhonePg,
  getUserBySessionTokenPg,
  insertUserPg,
  PASSWORD_RESET_TTL_MS_PG,
  setPasswordResetTokenForUserPg,
  touchUserLastActivePg,
  updateUserEmailNotifyPrefsPg,
  updateUserPasswordHashPg,
} from "./db-auth-pg.js";
import { pgAll, pgExec, pgGet } from "./pg-sql.js";
import { pgPool } from "./pg.js";
import { isEpochReached } from "./site-timezone.js";

export type { SessionUser, UserRow } from "./db-auth-pg.js";

export async function insertUser(
  phone: string,
  name: string,
  email: string | null,
  locality: string | null,
  passwordHash: string,
): Promise<number> {
  return insertUserPg(phone, name, email, locality, passwordHash);
}

export async function getUserByPhone(phone: string) {
  return getUserByPhonePg(phone);
}

export async function getUserByEmail(email: string) {
  return getUserByEmailPg(email);
}

export async function getUserById(id: number) {
  return getUserByIdPg(id);
}

export async function createSession(token: string, userId: number): Promise<void> {
  return createSessionPg(token, userId);
}

export async function touchUserLastActive(userId: number): Promise<void> {
  return touchUserLastActivePg(userId);
}

export async function getUserBySessionToken(token: string) {
  return getUserBySessionTokenPg(token);
}

/** Активные роли с полным доступом (владелец, разработчик, модератор; legacy admin). */
export async function countActivePrivilegedStaff(): Promise<number> {
  const r = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM users
     WHERE COALESCE(blocked,0) = 0
       AND LOWER(COALESCE(role,'user')) IN ('admin','owner','developer','moderator')`,
  );
  return Number(r?.c ?? 0);
}

/** @deprecated Используйте countActivePrivilegedStaff */
export async function countActiveAdmins(): Promise<number> {
  return countActivePrivilegedStaff();
}

export type AdminUserListRow = {
  id: number;
  phone: string;
  name: string;
  email: string;
  locality: string;
  role: string;
  blocked: number;
  created_at: number;
  last_active_at: number | null;
};

export async function listAllUsersForAdmin(): Promise<AdminUserListRow[]> {
  return pgAll<AdminUserListRow>(
    `SELECT id, phone, name, COALESCE(email,'') AS email, COALESCE(locality,'') AS locality,
            COALESCE(role,'user') AS role,
            COALESCE(blocked,0)::int AS blocked,
            created_at,
            last_active_at
     FROM users ORDER BY id DESC`,
  );
}

export async function countUsersForAdmin(): Promise<number> {
  const r = await pgGet<{ c: number }>(`SELECT COUNT(*)::int AS c FROM users`);
  return Number(r?.c ?? 0);
}

function adminUserLikePattern(raw: string): string {
  const t = raw
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  return `%${t}%`;
}

export async function countUsersForAdminBySearch(search: string): Promise<number> {
  const t = search.trim();
  if (!t) return countUsersForAdmin();
  const pat = adminUserLikePattern(t);
  const r = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM users
     WHERE lower(name) LIKE lower(?) ESCAPE '\\'
        OR lower(COALESCE(phone,'')) LIKE lower(?) ESCAPE '\\'
        OR lower(COALESCE(email,'')) LIKE lower(?) ESCAPE '\\'`,
    [pat, pat, pat],
  );
  return Number(r?.c ?? 0);
}

export async function countUsersForAdminByExactId(userId: number): Promise<number> {
  if (!Number.isFinite(userId) || userId <= 0 || !Number.isInteger(userId)) return 0;
  const r = await pgGet<{ c: number }>(`SELECT COUNT(*)::int AS c FROM users WHERE id = ?`, [userId]);
  return Number(r?.c ?? 0);
}

export async function listUsersForAdminPageByExactId(
  userId: number,
  offset: number,
  limit: number,
): Promise<AdminUserListRow[]> {
  if (!Number.isFinite(userId) || userId <= 0 || !Number.isInteger(userId)) return [];
  const lim = Math.min(Math.max(1, Math.floor(limit)), 100);
  const off = Math.max(0, Math.floor(offset));
  if (off > 0) return [];
  return pgAll<AdminUserListRow>(
    `SELECT id, phone, name, COALESCE(email,'') AS email, COALESCE(locality,'') AS locality,
            COALESCE(role,'user') AS role,
            COALESCE(blocked,0)::int AS blocked,
            created_at,
            last_active_at
     FROM users WHERE id = ? LIMIT ?`,
    [userId, lim],
  );
}

export async function listUsersForAdminPage(
  offset: number,
  limit: number,
  search: string | null,
): Promise<AdminUserListRow[]> {
  const lim = Math.min(Math.max(1, Math.floor(limit)), 100);
  const off = Math.max(0, Math.floor(offset));
  const t = search?.trim() ?? "";
  if (t) {
    const pat = adminUserLikePattern(t);
    return pgAll<AdminUserListRow>(
      `SELECT id, phone, name, COALESCE(email,'') AS email, COALESCE(locality,'') AS locality,
              COALESCE(role,'user') AS role,
              COALESCE(blocked,0)::int AS blocked,
              created_at,
              last_active_at
       FROM users
       WHERE lower(name) LIKE lower(?) ESCAPE '\\'
          OR lower(COALESCE(phone,'')) LIKE lower(?) ESCAPE '\\'
          OR lower(COALESCE(email,'')) LIKE lower(?) ESCAPE '\\'
       ORDER BY id ASC LIMIT ? OFFSET ?`,
      [pat, pat, pat, lim, off],
    );
  }
  return pgAll<AdminUserListRow>(
    `SELECT id, phone, name, COALESCE(email,'') AS email, COALESCE(locality,'') AS locality,
            COALESCE(role,'user') AS role,
            COALESCE(blocked,0)::int AS blocked,
            created_at,
            last_active_at
     FROM users ORDER BY id DESC LIMIT ? OFFSET ?`,
    [lim, off],
  );
}

export async function updateUserRole(userId: number, role: string): Promise<void> {
  await pgExec(`UPDATE users SET role = ? WHERE id = ?`, [role, userId]);
}

export async function updateUserBlocked(userId: number, blocked: 0 | 1): Promise<void> {
  await pgExec(`UPDATE users SET blocked = ? WHERE id = ?`, [blocked, userId]);
}

export async function deleteUserAccountByAdmin(userId: number): Promise<void> {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await pgExec(`DELETE FROM raffle_wholesale_assignments WHERE user_id = ?`, [userId], client);
    await pgExec(`DELETE FROM raffle_orders WHERE user_id = ?`, [userId], client);
    await pgExec(`DELETE FROM users WHERE id = ?`, [userId], client);
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteSession(token: string): Promise<void> {
  return deleteSessionPg(token);
}

export type SupportMessageRow = {
  id: number;
  user_id: number;
  body: string;
  is_staff: number;
  created_at: number;
  read_by_staff_at: number | null;
  read_by_user_at: number | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
};

export async function listSupportMessagesForUser(userId: number, limit = 200): Promise<SupportMessageRow[]> {
  return pgAll<SupportMessageRow>(
    `SELECT * FROM support_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT ?`,
    [userId, limit],
  );
}

export async function listLatestSupportMessagesForUser(userId: number, limit = 40): Promise<SupportMessageRow[]> {
  const rows = await pgAll<SupportMessageRow>(
    `SELECT * FROM support_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, Math.max(1, Math.min(200, Math.floor(limit)))],
  );
  rows.reverse();
  return rows;
}

export async function listSupportMessagesForUserBeforeId(
  userId: number,
  beforeId: number,
  limit = 40,
): Promise<SupportMessageRow[]> {
  const rows = await pgAll<SupportMessageRow>(
    `SELECT * FROM support_messages
     WHERE user_id = ? AND id < ?
     ORDER BY id DESC
     LIMIT ?`,
    [userId, beforeId, Math.max(1, Math.min(200, Math.floor(limit)))],
  );
  rows.reverse();
  return rows;
}

export async function getSupportMessageById(id: number): Promise<SupportMessageRow | undefined> {
  return pgGet<SupportMessageRow>(`SELECT * FROM support_messages WHERE id = ?`, [id]);
}

export async function deleteSupportStaffMessageForUser(userId: number, messageId: number): Promise<boolean> {
  const row = await pgGet<{ id: number }>(
    `DELETE FROM support_messages
     WHERE id = ? AND user_id = ? AND is_staff = 1
     RETURNING id`,
    [messageId, userId],
  );
  return !!row?.id;
}

export async function insertSupportMessage(
  userId: number,
  body: string,
  isStaff: boolean,
  attachment?: { url: string; name: string; mime: string } | null,
): Promise<number> {
  const now = Date.now();
  const readAt = isStaff ? now : null;
  const att = attachment ?? null;
  const row = await pgGet<{ id: number }>(
    `INSERT INTO support_messages (user_id, body, is_staff, created_at, read_by_staff_at, read_by_user_at, attachment_url, attachment_name, attachment_mime)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [
      userId,
      body.trim(),
      isStaff ? 1 : 0,
      now,
      readAt,
      null,
      att?.url ?? null,
      att?.name ?? null,
      att?.mime ?? null,
    ],
  );
  return Number(row?.id ?? 0);
}

export async function countUnreadStaffMessagesForUser(userId: number): Promise<number> {
  const r = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM support_messages
     WHERE user_id = ? AND is_staff = 1 AND read_by_user_at IS NULL`,
    [userId],
  );
  return Number(r?.c ?? 0);
}

export async function markStaffMessagesReadByUser(userId: number): Promise<void> {
  const now = Date.now();
  await pgExec(
    `UPDATE support_messages SET read_by_user_at = ? WHERE user_id = ? AND is_staff = 1 AND read_by_user_at IS NULL`,
    [now, userId],
  );
}

export async function markThreadReadByStaff(userId: number): Promise<void> {
  const now = Date.now();
  await pgExec(`UPDATE support_messages SET read_by_staff_at = ? WHERE user_id = ? AND is_staff = 0`, [
    now,
    userId,
  ]);
}

export function messageToDto(r: SupportMessageRow) {
  const isStaff = r.is_staff === 1;
  return {
    id: r.id,
    body: r.body,
    is_staff: isStaff,
    created_at: r.created_at,
    read_by_staff: isStaff ? false : r.read_by_staff_at != null,
    attachment_url: r.attachment_url ?? null,
    attachment_name: r.attachment_name ?? null,
    attachment_mime: r.attachment_mime ?? null,
  };
}

export async function updateUserProfile(
  id: number,
  data: { name: string; phone: string; email: string | null; locality?: string | null },
): Promise<void> {
  const em =
    data.email != null && String(data.email).trim()
      ? String(data.email)
          .trim()
          .toLowerCase()
      : null;
  const locality =
    data.locality != null && String(data.locality).trim()
      ? String(data.locality).trim().slice(0, 200)
      : null;
  await pgExec(`UPDATE users SET name = ?, phone = ?, email = ?, locality = ? WHERE id = ?`, [
    data.name,
    data.phone,
    em,
    locality,
    id,
  ]);
}

export async function updateUserEmailNotifyPrefs(
  userId: number,
  prefs: {
    email_notify_chat?: boolean;
    email_notify_raffles?: boolean;
    email_notify_raffle_orders?: boolean;
  },
): Promise<void> {
  return updateUserEmailNotifyPrefsPg(userId, prefs);
}

export async function listUsersForRaffleLaunchEmail(): Promise<{ id: number; email: string; name: string }[]> {
  return pgAll<{ id: number; email: string; name: string }>(
    `SELECT u.id, u.email, u.name FROM users u
     WHERE COALESCE(u.blocked, 0) = 0
       AND COALESCE(u.email_notify_raffles, 1) = 1
       AND TRIM(COALESCE(u.email, '')) != ''`,
  );
}

export async function clearRaffleLaunchNotifySent(raffleId: number): Promise<void> {
  await pgExec(`UPDATE raffles SET launch_notify_sent_at = NULL WHERE id = ?`, [raffleId]);
}

export async function markRaffleLaunchNotifySent(raffleId: number, ts: number): Promise<void> {
  await pgExec(`UPDATE raffles SET launch_notify_sent_at = ? WHERE id = ?`, [ts, raffleId]);
}

export async function updateUserPasswordHash(userId: number, passwordHash: string): Promise<void> {
  return updateUserPasswordHashPg(userId, passwordHash);
}

export async function deletePasswordResetTokensForUser(userId: number): Promise<void> {
  return deletePasswordResetTokensForUserPg(userId);
}

export async function cleanupExpiredPasswordResetTokens(): Promise<void> {
  return cleanupExpiredPasswordResetTokensPg();
}

export async function setPasswordResetTokenForUser(
  userId: number,
  tokenHash: string,
  expiresAt: number,
): Promise<void> {
  return setPasswordResetTokenForUserPg(userId, tokenHash, expiresAt);
}

export async function consumePasswordResetToken(tokenHash: string): Promise<number | null> {
  return consumePasswordResetTokenPg(tokenHash);
}

export { PASSWORD_RESET_TTL_MS_PG as PASSWORD_RESET_TTL_MS };

export type AdminThreadRow = {
  id: number;
  phone: string;
  name: string;
  email: string;
  locality: string;
  role: string;
  blocked: number;
  last_body: string | null;
  last_at: number | null;
  last_is_staff: number | null;
  unread_count: number;
};

export type AdminStatsUserTopRow = {
  user_id: number;
  user_name: string;
  user_phone: string;
  user_locality: string;
  ticket_count: number;
};

export type AdminStatsRaffleUserRow = {
  raffle_id: number;
  raffle_title: string;
  raffle_status: string;
  user_id: number;
  user_name: string;
  user_phone: string;
  user_locality: string;
  ticket_count: number;
};

export type AdminStatsLocalityGroup = {
  key: string;
  title: string;
  users_count: number;
  share_percent: number;
  variants: string[];
};

export type AdminUsersStatsPayload = {
  overview: {
    total_users: number;
    users_with_locality: number;
    users_without_locality: number;
    users_without_locality_percent: number;
  };
  top_users: Array<{
    user_id: number;
    name: string;
    phone: string;
    locality: string;
    tickets_confirmed: number;
  }>;
  raffles: Array<{
    raffle_id: number;
    title: string;
    status: string;
    participants_count: number;
    tickets_count: number;
    top_users: Array<{
      user_id: number;
      name: string;
      phone: string;
      locality: string;
      tickets_count: number;
    }>;
  }>;
  localities: AdminStatsLocalityGroup[];
};

function normalizeLocalityKey(raw: string): string {
  let s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/ё/g, "е");
  s = s.replace(/[.,/#!$%^&*;:{}=_`~()"']/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^(г|гор|город|пгт|п\.г\.т|пос|поселок|поселок|поселок\s+городского\s+типа|п|с|село|д|деревня|рп|р\.п)\s+/i, "");
  s = s.replace(/^(г|пгт|п|с|д|рп)\./i, "");
  s = s.replace(/\s+/g, "");
  s = s.replace(/[^a-zа-я0-9-]/gi, "");
  return s.trim();
}

function localityPhoneticKey(raw: string): string {
  let s = normalizeLocalityKey(raw);
  if (!s) return "";
  // Rough phonetic normalization for common Russian typos/variants.
  s = s
    .replace(/ий$/g, "и")
    .replace(/ый$/g, "и")
    .replace(/ая$/g, "а")
    .replace(/ое$/g, "а")
    .replace(/[ъь]/g, "")
    .replace(/й/g, "и")
    .replace(/ы/g, "и")
    .replace(/э/g, "е")
    .replace(/ю/g, "у")
    .replace(/я/g, "а")
    .replace(/щ/g, "ш")
    .replace(/ч/g, "ш");
  // Collapse repeated characters (e.g. "оловяннааая").
  s = s.replace(/(.)\1+/g, "$1");
  return s;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) dp[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j];
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + cost,
      );
      prev = tmp;
    }
  }
  return dp[b.length];
}

function canMergeLocalityKeys(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length <= 2 || b.length <= 2) return false;
  if (a.includes(b) || b.includes(a)) {
    return Math.abs(a.length - b.length) <= 2;
  }
  const dist = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen <= 6) return dist <= 1;
  if (maxLen <= 10) return dist <= 2;
  return dist <= 3;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type AdminDashboardPayload = {
  generated_at: number;
  metrics: {
    total_users: number;
    active_raffles: number;
    total_raffles: number;
    pending_payments: number;
    prizes_need_attention: number;
    unread_support_messages: number;
    unread_support_threads: number;
  };
  site: {
    maintenance_enabled: boolean;
    blog_enabled: boolean;
    music_enabled: boolean;
  };
};

export async function getAdminDashboardSummary(): Promise<AdminDashboardPayload> {
  const usersRow = await pgGet<{ total: number }>(`SELECT COUNT(*)::int AS total FROM users`);
  const rafflesRow = await pgGet<{ active: number; total: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active,
            COUNT(*)::int AS total
       FROM raffles`,
  );
  const pendingPayRow = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM raffle_orders WHERE status = 'pending_review'`,
  );
  const prizesRow = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM prize_awards WHERE status IN ('pending', 'claimed', 'processing')`,
  );
  const unreadRow = await pgGet<{ messages: number; threads: number }>(
    `SELECT COUNT(*)::int AS messages,
            COUNT(DISTINCT user_id)::int AS threads
       FROM support_messages
      WHERE is_staff = 0 AND read_by_staff_at IS NULL`,
  );
  const site = await getSiteSettings();
  return {
    generated_at: Date.now(),
    metrics: {
      total_users: Math.max(0, Number(usersRow?.total ?? 0)),
      active_raffles: Math.max(0, Number(rafflesRow?.active ?? 0)),
      total_raffles: Math.max(0, Number(rafflesRow?.total ?? 0)),
      pending_payments: Math.max(0, Number(pendingPayRow?.c ?? 0)),
      prizes_need_attention: Math.max(0, Number(prizesRow?.c ?? 0)),
      unread_support_messages: Math.max(0, Number(unreadRow?.messages ?? 0)),
      unread_support_threads: Math.max(0, Number(unreadRow?.threads ?? 0)),
    },
    site: {
      maintenance_enabled: site.maintenance_enabled,
      blog_enabled: site.blog_enabled,
      music_enabled: site.music_enabled,
    },
  };
}

export async function getAdminUsersStats(): Promise<AdminUsersStatsPayload> {
  const usersTotals = await pgGet<{ total: number; with_loc: number; without_loc: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE TRIM(COALESCE(locality,'')) <> '')::int AS with_loc,
            COUNT(*) FILTER (WHERE TRIM(COALESCE(locality,'')) = '')::int AS without_loc
       FROM users`,
  );
  const totalUsers = Number(usersTotals?.total ?? 0);
  const withLoc = Number(usersTotals?.with_loc ?? 0);
  const withoutLoc = Number(usersTotals?.without_loc ?? 0);
  const withoutLocPct = totalUsers > 0 ? round2((withoutLoc * 100) / totalUsers) : 0;

  const topUsersRows = await pgAll<AdminStatsUserTopRow>(
    `SELECT o.user_id AS user_id,
            COALESCE(u.name, 'Пользователь #' || o.user_id::text) AS user_name,
            COALESCE(u.phone, '') AS user_phone,
            COALESCE(u.locality, '') AS user_locality,
            COUNT(*)::int AS ticket_count
       FROM raffle_ticket_holds h
       JOIN raffle_orders o ON o.id = h.order_id
       LEFT JOIN users u ON u.id = o.user_id
      WHERE o.status = 'confirmed'
        AND COALESCE(h.is_bonus, 0) = 0
      GROUP BY o.user_id, u.name, u.phone, u.locality
      ORDER BY ticket_count DESC, o.user_id ASC
      LIMIT 30`,
  );

  const raffleRows = await pgAll<AdminStatsRaffleUserRow>(
    `SELECT r.id AS raffle_id,
            r.title AS raffle_title,
            r.status AS raffle_status,
            o.user_id AS user_id,
            COALESCE(u.name, 'Пользователь #' || o.user_id::text) AS user_name,
            COALESCE(u.phone, '') AS user_phone,
            COALESCE(u.locality, '') AS user_locality,
            COUNT(*)::int AS ticket_count
       FROM raffle_ticket_holds h
       JOIN raffle_orders o ON o.id = h.order_id
       JOIN raffles r ON r.id = h.raffle_id
       LEFT JOIN users u ON u.id = o.user_id
      WHERE COALESCE(h.is_bonus, 0) = 0
        AND (
          o.status IN ('confirmed', 'pending_review')
          OR (o.status = 'reserved' AND o.reserved_until > ?)
        )
      GROUP BY r.id, r.title, r.status, o.user_id, u.name, u.phone, u.locality
      ORDER BY r.id DESC, ticket_count DESC, o.user_id ASC`,
    [Date.now()],
  );

  const byRaffle = new Map<number, AdminUsersStatsPayload["raffles"][number]>();
  for (const row of raffleRows) {
    const rid = Math.floor(Number(row.raffle_id) || 0);
    if (rid <= 0) continue;
    const existing = byRaffle.get(rid);
    const userEntry = {
      user_id: Math.floor(Number(row.user_id) || 0),
      name: String(row.user_name || ""),
      phone: String(row.user_phone || ""),
      locality: String(row.user_locality || "").trim(),
      tickets_count: Math.floor(Number(row.ticket_count) || 0),
    };
    if (!existing) {
      byRaffle.set(rid, {
        raffle_id: rid,
        title: String(row.raffle_title || "Акция"),
        status: String(row.raffle_status || "active"),
        participants_count: userEntry.user_id > 0 ? 1 : 0,
        tickets_count: Math.max(0, userEntry.tickets_count),
        top_users: userEntry.user_id > 0 ? [userEntry] : [],
      });
      continue;
    }
    existing.tickets_count += Math.max(0, userEntry.tickets_count);
    if (userEntry.user_id > 0) {
      existing.participants_count += 1;
      if (existing.top_users.length < 10) existing.top_users.push(userEntry);
    }
  }
  const raffles = Array.from(byRaffle.values()).map((r) => {
    r.top_users.sort((a, b) => b.tickets_count - a.tickets_count || a.user_id - b.user_id);
    if (r.top_users.length > 5) r.top_users = r.top_users.slice(0, 5);
    return r;
  });

  const rawLocalities = await pgAll<{ locality: string; users_count: number }>(
    `SELECT TRIM(COALESCE(locality, '')) AS locality, COUNT(*)::int AS users_count
       FROM users
      WHERE TRIM(COALESCE(locality, '')) <> ''
      GROUP BY TRIM(COALESCE(locality, ''))
      ORDER BY users_count DESC, locality ASC`,
  );
  const grouped = new Map<string, { users_count: number; variants: Map<string, number>; phonetic: string }>();
  for (const row of rawLocalities) {
    const src = String(row.locality || "").trim();
    if (!src) continue;
    const normalized = normalizeLocalityKey(src);
    let key = normalized || src.toLowerCase();
    let phonetic = localityPhoneticKey(src) || key;

    // Fast exact or near-exact shortcuts.
    if (key.startsWith("п") && key.length > 4) {
      const alt = key.slice(1);
      if (grouped.has(alt)) key = alt;
    }

    // Fuzzy merge: choose closest existing group by phonetic + edit distance.
    if (!grouped.has(key)) {
      let bestKey = "";
      let bestScore = Number.POSITIVE_INFINITY;
      for (const [gKey, gVal] of grouped.entries()) {
        const gPh = gVal.phonetic || gKey;
        const phoneticClose = canMergeLocalityKeys(phonetic, gPh);
        const textClose = canMergeLocalityKeys(key, gKey);
        if (!phoneticClose && !textClose) continue;
        const score = Math.min(
          levenshteinDistance(key, gKey),
          levenshteinDistance(phonetic, gPh),
        );
        if (score < bestScore) {
          bestScore = score;
          bestKey = gKey;
          if (bestScore === 0) break;
        }
      }
      if (bestKey) key = bestKey;
    }

    const c = Math.max(0, Math.floor(Number(row.users_count) || 0));
    if (!grouped.has(key)) {
      grouped.set(key, { users_count: 0, variants: new Map<string, number>(), phonetic });
    }
    const g = grouped.get(key)!;
    g.users_count += c;
    g.variants.set(src, (g.variants.get(src) || 0) + c);
    if (!g.phonetic && phonetic) g.phonetic = phonetic;
  }
  const localities: AdminStatsLocalityGroup[] = Array.from(grouped.entries())
    .map(([key, val]) => {
      const variantsSorted = Array.from(val.variants.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const title = variantsSorted.length ? variantsSorted[0][0] : key;
      const variants = variantsSorted.map((x) => x[0]).slice(0, 8);
      const share = totalUsers > 0 ? round2((val.users_count * 100) / totalUsers) : 0;
      return { key, title, users_count: val.users_count, share_percent: share, variants };
    })
    .sort((a, b) => b.users_count - a.users_count || a.title.localeCompare(b.title))
    .slice(0, 200);

  return {
    overview: {
      total_users: totalUsers,
      users_with_locality: withLoc,
      users_without_locality: withoutLoc,
      users_without_locality_percent: withoutLocPct,
    },
    top_users: topUsersRows.map((x) => ({
      user_id: Math.floor(Number(x.user_id) || 0),
      name: String(x.user_name || ""),
      phone: String(x.user_phone || ""),
      locality: String(x.user_locality || "").trim(),
      tickets_confirmed: Math.max(0, Math.floor(Number(x.ticket_count) || 0)),
    })),
    raffles,
    localities,
  };
}

export type RaffleRow = {
  id: number;
  raffle_hash?: string;
  title: string;
  cover_image_url: string;
  cover_gif_url?: string;
  price_rub: number;
  base_price_rub: number;
  cenopad_enabled?: number;
  cenopad_price_rub?: number;
  cenopad_start_at?: number | null;
  cenopad_end_at?: number | null;
  old_price_rub?: number;
  ticket_count: number;
  collection_url: string;
  tbank_collection_url?: string;
  collection_recipient: string;
  sber_collection_recipient?: string;
  tbank_collection_recipient?: string;
  qr_image_url: string;
  qr_recipient?: string;
  qr_payment_purpose?: string;
  sber_enabled?: number;
  tbank_enabled?: number;
  qr_enabled?: number;
  rules_url?: string;
  live_stream_note?: string;
  live_stream_url?: string;
  live_stream_at?: number | null;
  live_stream_status?: string;
  live_stream_show_on_card?: number;
  status: string;
  sort_order: number;
  wholesale_enabled: number;
  /** Сколько подтверждённых небонусных номерков у пользователя дают следующий номер оптовика (глобальная очередь). */
  wholesale_every_n_tickets?: number;
  /** unlimited | wholesale_only | min_order_tickets */
  card_payment_scope?: string;
  /** Порог номерков в одном заказе при card_payment_scope = min_order_tickets */
  card_payment_min_tickets?: number;
  promo_5_plus_1_enabled?: number;
  promo_5_plus_1_locked_free_count?: number;
  promo_5_plus_2_enabled?: number;
  promo_5_plus_2_locked_free_count?: number;
  hidden_from_public?: number;
  /** Старт продаж / показа на сайте (epoch ms, агинское «настенное» время при вводе в админке). */
  public_start_at?: number | null;
  /** Скрыть прогресс-бар и счётчики свободных/занятых номерков на сайте. */
  hide_ticket_stats?: number;
  /** Показывать таблицы номерков по очереди: размер блока (0 — все сразу). */
  sequential_batch_size?: number;
  /** Сколько номерков участник может выбрать в одной брони. */
  max_tickets_per_user?: number;
  /** Сколько номерков участник может иметь на аккаунте за всю акцию (0 — без лимита). */
  max_tickets_per_user_total?: number;
  /** Первый номерок в акции (по умолчанию 1). */
  ticket_start_number?: number;
  launch_notify_sent_at?: number | null;
  created_at: number;
  updated_at: number;
};

export type RaffleDto = {
  id: number;
  raffle_hash: string;
  title: string;
  cover_image_url: string;
  cover_gif_url: string;
  price_rub: number;
  /** Базовая цена билета без учёта активной второй цены (ценопада) — для отображения и расчётов. */
  base_price_rub: number;
  cenopad_enabled?: boolean;
  cenopad_price_rub?: number | null;
  second_price_enabled?: boolean;
  second_price_rub?: number | null;
  second_price_start_at?: number | null;
  second_price_end_at?: number | null;
  cenopad_sold_count?: number;
  old_price_rub: number | null;
  ticket_count: number;
  collection_url: string;
  tbank_collection_url: string;
  collection_recipient: string;
  sber_collection_recipient: string;
  tbank_collection_recipient: string;
  qr_image_url: string;
  qr_recipient: string;
  qr_payment_purpose: string;
  sber_enabled: boolean;
  tbank_enabled: boolean;
  qr_enabled: boolean;
  rules_url: string | null;
  live_stream_note: string | null;
  live_stream_url: string | null;
  live_stream_at: number | null;
  live_stream_status: "scheduled" | "live" | "ended" | null;
  live_stream_show_on_card: boolean;
  status: "active" | "closed" | "paused";
  sort_order: number;
  wholesale_enabled: boolean;
  wholesale_every_n_tickets: number;
  card_payment_scope: "unlimited" | "wholesale_only" | "min_order_tickets";
  /** Минимум номерков в заказе для оплаты на карту при scope min_order_tickets */
  card_payment_min_tickets: number;
  promo_5_plus_1_enabled: boolean;
  promo_5_plus_1_locked_free_count: number;
  promo_5_plus_2_enabled: boolean;
  promo_5_plus_2_locked_free_count: number;
  hidden_from_public?: boolean;
  public_start_at?: number | null;
  /** Продажи открыты по серверному времени (учитывает public_start_at). */
  sales_open?: boolean;
  hide_ticket_stats: boolean;
  /** 0 — все диапазоны сразу; иначе размер очередного блока номерков. */
  sequential_batch_size: number;
  /** Лимит номерков в одной брони. */
  max_tickets_per_user: number;
  /** Лимит номерков на аккаунт за всю акцию; 0 — без общего лимита. */
  max_tickets_per_user_total: number;
  /** Первый номерок в акции. */
  ticket_start_number: number;
  /** Последний номерок (ticket_start_number + ticket_count − 1). */
  ticket_end_number: number;
  /** Текущий открытый блок при sequential_batch_size > 0 (заполняется API). */
  sequential_window_from?: number | null;
  sequential_window_to?: number | null;
  /** Все открытые блоки очереди (включая полностью занятые). */
  sequential_windows?: Array<{ from: number; to: number }> | null;
};

export function getRaffleTicketStartNumber(
  r: { ticket_start_number?: number | null } | null | undefined,
): number {
  const n = Math.floor(Number(r?.ticket_start_number ?? 1));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

export function getRaffleTicketEndNumber(
  r: { ticket_count: number; ticket_start_number?: number | null } | null | undefined,
): number {
  if (!r) return 0;
  const start = getRaffleTicketStartNumber(r);
  const count = Math.max(0, Math.floor(Number(r.ticket_count)));
  if (count < 1) return start - 1;
  return start + count - 1;
}

export function isRaffleTicketNumberInRange(
  r: { ticket_count: number; ticket_start_number?: number | null },
  n: number,
): boolean {
  const tn = Math.floor(Number(n));
  if (!Number.isFinite(tn)) return false;
  return tn >= getRaffleTicketStartNumber(r) && tn <= getRaffleTicketEndNumber(r);
}

export function raffleToDto(r: RaffleRow, opts?: { forAdmin?: boolean }): RaffleDto {
  const st = r.status === "closed" || r.status === "paused" ? r.status : "active";
  const oldP = Number(r.old_price_rub ?? 0);
  const rulesRaw = String((r as RaffleRow).rules_url ?? "").trim();
  const liveStreamNoteRaw = String((r as RaffleRow).live_stream_note ?? "").trim();
  const liveStreamUrlRaw = String((r as RaffleRow).live_stream_url ?? "").trim();
  const liveStreamAtRaw = Number((r as RaffleRow).live_stream_at ?? 0);
  const liveStreamAt = Number.isFinite(liveStreamAtRaw) && liveStreamAtRaw > 0 ? Math.floor(liveStreamAtRaw) : null;
  const streamStatusRaw = String((r as RaffleRow).live_stream_status ?? "")
    .trim()
    .toLowerCase();
  const liveStreamStatus =
    streamStatusRaw === "scheduled" || streamStatusRaw === "live" || streamStatusRaw === "ended"
      ? streamStatusRaw
      : null;
  const cenopadEnabled = Boolean(Number((r as RaffleRow).cenopad_enabled ?? 0));
  const cenopadPriceRaw = Math.floor(Number((r as RaffleRow).cenopad_price_rub ?? 0));
  const cenopadPrice = cenopadPriceRaw > 0 ? cenopadPriceRaw : 0;
  const secondPriceStartRaw = Number((r as RaffleRow).cenopad_start_at ?? 0);
  const secondPriceEndRaw = Number((r as RaffleRow).cenopad_end_at ?? 0);
  const secondPriceStart = Number.isFinite(secondPriceStartRaw) && secondPriceStartRaw > 0 ? Math.floor(secondPriceStartRaw) : null;
  const secondPriceEnd = Number.isFinite(secondPriceEndRaw) && secondPriceEndRaw > 0 ? Math.floor(secondPriceEndRaw) : null;
  const effectivePrice =
    !opts?.forAdmin && isRaffleCenopadActive(r) && cenopadPrice > 0
      ? cenopadPrice
      : Math.max(0, Math.floor(Number(r.price_rub ?? 0)));
  const dto: RaffleDto = {
    id: r.id,
    raffle_hash: String((r as RaffleRow).raffle_hash ?? ""),
    title: r.title,
    cover_image_url: r.cover_image_url,
    cover_gif_url: String((r as RaffleRow).cover_gif_url ?? "").trim(),
    price_rub: effectivePrice,
    base_price_rub: Math.max(0, Math.floor(Number(r.price_rub ?? 0))),
    cenopad_enabled: cenopadEnabled,
    cenopad_price_rub: cenopadPrice > 0 ? cenopadPrice : null,
    second_price_enabled: cenopadEnabled,
    second_price_rub: cenopadPrice > 0 ? cenopadPrice : null,
    second_price_start_at: secondPriceStart,
    second_price_end_at: secondPriceEnd,
    old_price_rub: oldP > 0 ? oldP : null,
    ticket_count: r.ticket_count,
    collection_url: r.collection_url,
    tbank_collection_url: String((r as RaffleRow).tbank_collection_url ?? ""),
    collection_recipient: r.collection_recipient,
    sber_collection_recipient: String(
      (r as RaffleRow).sber_collection_recipient ?? r.collection_recipient ?? "",
    ),
    tbank_collection_recipient: String(
      (r as RaffleRow).tbank_collection_recipient ?? r.collection_recipient ?? "",
    ),
    qr_image_url: r.qr_image_url,
    qr_recipient: String((r as RaffleRow).qr_recipient ?? r.collection_recipient ?? ""),
    qr_payment_purpose: String((r as RaffleRow).qr_payment_purpose ?? "Оплата услуг"),
    sber_enabled: Boolean(Number((r as RaffleRow).sber_enabled ?? 1)),
    tbank_enabled: Boolean(Number((r as RaffleRow).tbank_enabled ?? 0)),
    qr_enabled: Boolean(Number((r as RaffleRow).qr_enabled ?? 1)),
    rules_url: rulesRaw ? rulesRaw : null,
    live_stream_note: liveStreamNoteRaw ? liveStreamNoteRaw : null,
    live_stream_url: liveStreamUrlRaw ? liveStreamUrlRaw : null,
    live_stream_at: liveStreamAt,
    live_stream_status: liveStreamStatus,
    live_stream_show_on_card: Boolean(Number((r as RaffleRow).live_stream_show_on_card ?? 0)),
    status: st,
    sort_order: r.sort_order,
    wholesale_enabled: Boolean((r as RaffleRow).wholesale_enabled),
    wholesale_every_n_tickets: Math.max(
      1,
      Math.floor(Number((r as RaffleRow).wholesale_every_n_tickets ?? 10)),
    ),
    card_payment_scope: (() => {
      const s = String((r as RaffleRow).card_payment_scope ?? "")
        .trim()
        .toLowerCase();
      if (s === "wholesale_only") return "wholesale_only" as const;
      if (s === "min_order_tickets") return "min_order_tickets" as const;
      return "unlimited" as const;
    })(),
    card_payment_min_tickets: Math.max(
      1,
      Math.floor(Number((r as RaffleRow).card_payment_min_tickets ?? 2)),
    ),
    promo_5_plus_1_enabled: Boolean(Number((r as RaffleRow).promo_5_plus_1_enabled ?? 0)),
    promo_5_plus_1_locked_free_count: Math.max(
      0,
      Math.floor(Number((r as RaffleRow).promo_5_plus_1_locked_free_count ?? 0)),
    ),
    promo_5_plus_2_enabled: Boolean(Number((r as RaffleRow).promo_5_plus_2_enabled ?? 0)),
    promo_5_plus_2_locked_free_count: Math.max(
      0,
      Math.floor(Number((r as RaffleRow).promo_5_plus_2_locked_free_count ?? 0)),
    ),
    hide_ticket_stats: Boolean(Number((r as RaffleRow).hide_ticket_stats ?? 0)),
    sequential_batch_size: Math.max(
      0,
      Math.floor(Number((r as RaffleRow).sequential_batch_size ?? 0)),
    ),
    max_tickets_per_user: Math.max(
      1,
      Math.min(500, Math.floor(Number((r as RaffleRow).max_tickets_per_user ?? 25))),
    ),
    max_tickets_per_user_total: Math.max(
      0,
      Math.min(5000, Math.floor(Number((r as RaffleRow).max_tickets_per_user_total ?? 0))),
    ),
    ticket_start_number: getRaffleTicketStartNumber(r as RaffleRow),
    ticket_end_number: getRaffleTicketEndNumber(r as RaffleRow),
  };
  const publicStartRaw = Number((r as RaffleRow).public_start_at ?? 0);
  const public_start_at =
    Number.isFinite(publicStartRaw) && publicStartRaw > 0 ? Math.floor(publicStartRaw) : null;
  dto.public_start_at = public_start_at;
  dto.sales_open = isRaffleSalesOpen(r);
  if (opts?.forAdmin) {
    dto.hidden_from_public = Boolean(Number((r as RaffleRow).hidden_from_public));
  }
  return dto;
}

export function isRaffleVisibleOnSite(r: RaffleRow | undefined): boolean {
  if (!r) return false;
  return !Number((r as RaffleRow).hidden_from_public);
}

/** Продажи и бронь номерков — только после public_start_at по серверному времени. */
export function isRaffleSalesOpen(r: RaffleRow | undefined, nowMs = Date.now()): boolean {
  if (!r || !isRaffleVisibleOnSite(r)) return false;
  if (r.status !== "active") return false;
  const startAt = Math.floor(Number((r as RaffleRow).public_start_at ?? 0));
  return isEpochReached(startAt > 0 ? startAt : null, nowMs);
}

export function isRaffleCenopadActive(r: RaffleRow | undefined, nowMs = Date.now()): boolean {
  if (!r) return false;
  const enabled = Boolean(Number((r as RaffleRow).cenopad_enabled ?? 0));
  const p = Math.floor(Number((r as RaffleRow).cenopad_price_rub ?? 0));
  if (!(enabled && p > 0)) return false;
  const startAt = Math.floor(Number((r as RaffleRow).cenopad_start_at ?? 0));
  const endAt = Math.floor(Number((r as RaffleRow).cenopad_end_at ?? 0));
  const now = Math.floor(Number(nowMs));
  if (Number.isFinite(startAt) && startAt > 0 && now < startAt) return false;
  if (Number.isFinite(endAt) && endAt > 0 && now > endAt) return false;
  return true;
}

export function getRaffleEffectiveUnitPrice(r: RaffleRow | undefined): number {
  if (!r) return 0;
  return isRaffleCenopadActive(r)
    ? Math.max(0, Math.floor(Number((r as RaffleRow).cenopad_price_rub ?? 0)))
    : Math.max(0, Math.floor(Number(r.price_rub ?? 0)));
}

export async function countConfirmedTicketsSoldByCenopad(raffleId: number): Promise<number> {
  const row = await pgGet<{ n?: number }>(
    `SELECT COUNT(*)::int AS n
     FROM raffle_ticket_holds th
     INNER JOIN raffle_orders o ON o.id = th.order_id
     WHERE th.raffle_id = ?
       AND th.hold_status = 'confirmed'
       AND COALESCE(th.is_bonus, 0) = 0
       AND COALESCE(o.cenopad_applied, 0) = 1`,
    [raffleId],
  );
  return Math.max(0, Number(row?.n || 0));
}

export type RaffleSalesAccounting = {
  base_tickets: number;
  base_amount_rub: number;
  second_tickets: number;
  second_amount_rub: number;
};

export async function getRaffleSalesAccounting(raffleId: number): Promise<RaffleSalesAccounting> {
  const row = await pgGet<{
    base_tickets?: number;
    base_amount_rub?: number;
    second_tickets?: number;
    second_amount_rub?: number;
  }>(
    `WITH hold_counts AS (
       SELECT
         o.id AS order_id,
         COALESCE(o.cenopad_applied, 0)::int AS cenopad_applied,
         COUNT(*)::int AS hold_count
       FROM raffle_orders o
       INNER JOIN raffle_ticket_holds h ON h.order_id = o.id
       WHERE o.raffle_id = ? AND o.status = 'confirmed' AND COALESCE(h.is_bonus, 0) = 0
       GROUP BY o.id, COALESCE(o.cenopad_applied, 0)
     )
     SELECT
       COALESCE(SUM(CASE WHEN cenopad_applied = 0 THEN hold_count ELSE 0 END), 0)::int AS base_tickets,
       COALESCE(SUM(CASE WHEN cenopad_applied = 0 THEN hold_count * r.price_rub ELSE 0 END), 0)::bigint AS base_amount_rub,
       COALESCE(SUM(CASE WHEN cenopad_applied = 1 THEN hold_count ELSE 0 END), 0)::int AS second_tickets,
       COALESCE(SUM(CASE WHEN cenopad_applied = 1 THEN hold_count * COALESCE(NULLIF(r.cenopad_price_rub,0), r.price_rub) ELSE 0 END), 0)::bigint AS second_amount_rub
     FROM hold_counts hc
     INNER JOIN raffles r ON r.id = ?`,
    [raffleId, raffleId],
  );
  return {
    base_tickets: Math.max(0, Number(row?.base_tickets ?? 0)),
    base_amount_rub: Math.max(0, Number(row?.base_amount_rub ?? 0)),
    second_tickets: Math.max(0, Number(row?.second_tickets ?? 0)),
    second_amount_rub: Math.max(0, Number(row?.second_amount_rub ?? 0)),
  };
}

export async function listRafflesAll(): Promise<RaffleRow[]> {
  return pgAll<RaffleRow>(`SELECT * FROM raffles ORDER BY sort_order ASC, id DESC`);
}

export async function listRafflesPublic(): Promise<RaffleRow[]> {
  return pgAll<RaffleRow>(
    `SELECT * FROM raffles WHERE COALESCE(hidden_from_public, 0) = 0 ORDER BY id DESC`,
  );
}

export async function getLatestVisibleActiveRaffle(nowMs = Date.now()): Promise<RaffleRow | undefined> {
  const rows = await pgAll<RaffleRow>(
    `SELECT * FROM raffles
     WHERE COALESCE(hidden_from_public, 0) = 0 AND status = 'active'
     ORDER BY id DESC
     LIMIT 20`,
  );
  for (const row of rows) {
    if (isRaffleSalesOpen(row, nowMs)) return row;
  }
  return undefined;
}

export async function getRaffleById(id: number): Promise<RaffleRow | undefined> {
  return pgGet<RaffleRow>(`SELECT * FROM raffles WHERE id = ?`, [id]);
}

export async function getRaffleByHash(hash: string): Promise<RaffleRow | undefined> {
  for (const h of raffleHashLookupCandidates(hash)) {
    const row = await pgGet<RaffleRow>(`SELECT * FROM raffles WHERE raffle_hash = ?`, [h]);
    if (row) return row;
  }
  return undefined;
}

export async function insertRaffle(data: {
  title: string;
  cover_image_url: string;
  cover_gif_url?: string;
  price_rub: number;
  cenopad_enabled: number;
  cenopad_price_rub: number;
  cenopad_start_at: number | null;
  cenopad_end_at: number | null;
  old_price_rub: number;
  ticket_count: number;
  collection_url: string;
  tbank_collection_url: string;
  collection_recipient: string;
  sber_collection_recipient: string;
  tbank_collection_recipient: string;
  qr_image_url: string;
  qr_recipient: string;
  qr_payment_purpose: string;
  sber_enabled: number;
  tbank_enabled: number;
  qr_enabled: number;
  rules_url: string;
  live_stream_note: string;
  live_stream_url: string;
  live_stream_at: number | null;
  live_stream_status: string;
  live_stream_show_on_card: number;
  status: string;
  sort_order: number;
  wholesale_enabled: number;
  wholesale_every_n_tickets: number;
  card_payment_scope: string;
  card_payment_min_tickets: number;
  promo_5_plus_1_enabled: number;
  promo_5_plus_2_enabled: number;
  hidden_from_public: number;
  hide_ticket_stats: number;
  sequential_batch_size: number;
  max_tickets_per_user: number;
  max_tickets_per_user_total: number;
  ticket_start_number: number;
  public_start_at: number | null;
}): Promise<number> {
  const now = Date.now();
  const row = await pgGet<{ id: number }>(
    `INSERT INTO raffles (
      raffle_hash, title, cover_image_url, cover_gif_url, price_rub, cenopad_enabled, cenopad_price_rub, old_price_rub, ticket_count,
      cenopad_start_at, cenopad_end_at,
      collection_url, tbank_collection_url, collection_recipient, sber_collection_recipient, tbank_collection_recipient, qr_image_url, qr_recipient, qr_payment_purpose,
      sber_enabled, tbank_enabled, qr_enabled, rules_url, live_stream_note, live_stream_url, live_stream_at, live_stream_status, live_stream_show_on_card,
      status, sort_order, wholesale_enabled, wholesale_every_n_tickets, card_payment_scope, card_payment_min_tickets, promo_5_plus_1_enabled, promo_5_plus_2_enabled, hidden_from_public, hide_ticket_stats, sequential_batch_size, max_tickets_per_user, max_tickets_per_user_total, ticket_start_number, public_start_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id`,
    [
      randomUUID(),
      data.title,
      data.cover_image_url,
      String(data.cover_gif_url ?? ""),
      data.price_rub,
      data.cenopad_enabled,
      data.cenopad_price_rub,
      data.old_price_rub,
      data.ticket_count,
      data.cenopad_start_at,
      data.cenopad_end_at,
      data.collection_url,
      data.tbank_collection_url,
      data.collection_recipient,
      data.sber_collection_recipient,
      data.tbank_collection_recipient,
      data.qr_image_url,
      data.qr_recipient,
      data.qr_payment_purpose,
      data.sber_enabled,
      data.tbank_enabled,
      data.qr_enabled,
      data.rules_url,
      data.live_stream_note,
      data.live_stream_url,
      data.live_stream_at,
      data.live_stream_status,
      data.live_stream_show_on_card,
      data.status,
      data.sort_order,
      data.wholesale_enabled,
      data.wholesale_every_n_tickets,
      data.card_payment_scope,
      data.card_payment_min_tickets,
      data.promo_5_plus_1_enabled,
      data.promo_5_plus_2_enabled,
      data.hidden_from_public,
      data.hide_ticket_stats,
      data.sequential_batch_size,
      data.max_tickets_per_user,
      data.max_tickets_per_user_total,
      data.ticket_start_number,
      data.public_start_at,
      now,
      now,
    ],
  );
  return Number(row?.id ?? 0);
}

export async function updateRaffle(
  id: number,
  data: {
    title: string;
    cover_image_url: string;
    cover_gif_url: string;
    price_rub: number;
    cenopad_enabled: number;
    cenopad_price_rub: number;
    cenopad_start_at: number | null;
    cenopad_end_at: number | null;
    old_price_rub: number;
    ticket_count: number;
    collection_url: string;
    tbank_collection_url: string;
    collection_recipient: string;
    sber_collection_recipient: string;
    tbank_collection_recipient: string;
    qr_image_url: string;
    qr_recipient: string;
    qr_payment_purpose: string;
    sber_enabled: number;
    tbank_enabled: number;
    qr_enabled: number;
    rules_url: string;
    live_stream_note: string;
    live_stream_url: string;
    live_stream_at: number | null;
    live_stream_status: string;
    live_stream_show_on_card: number;
    status: string;
    sort_order: number;
    wholesale_enabled: number;
    wholesale_every_n_tickets: number;
    card_payment_scope: string;
    card_payment_min_tickets: number;
    promo_5_plus_1_enabled: number;
    promo_5_plus_2_enabled: number;
    hidden_from_public: number;
    hide_ticket_stats: number;
    sequential_batch_size: number;
    max_tickets_per_user: number;
    max_tickets_per_user_total: number;
    ticket_start_number: number;
    public_start_at: number | null;
  },
): Promise<void> {
  await pgExec(
    `UPDATE raffles SET
      title = ?, cover_image_url = ?, cover_gif_url = ?, price_rub = ?, old_price_rub = ?, ticket_count = ?,
      cenopad_enabled = ?, cenopad_price_rub = ?,
      cenopad_start_at = ?, cenopad_end_at = ?,
      collection_url = ?, tbank_collection_url = ?, collection_recipient = ?, sber_collection_recipient = ?, tbank_collection_recipient = ?, qr_image_url = ?, qr_recipient = ?, qr_payment_purpose = ?, rules_url = ?, live_stream_note = ?, live_stream_url = ?,
      live_stream_at = ?, live_stream_status = ?, live_stream_show_on_card = ?,
      sber_enabled = ?, tbank_enabled = ?, qr_enabled = ?,
      status = ?, sort_order = ?, wholesale_enabled = ?, wholesale_every_n_tickets = ?, card_payment_scope = ?, card_payment_min_tickets = ?, promo_5_plus_1_enabled = ?, promo_5_plus_2_enabled = ?, hidden_from_public = ?, hide_ticket_stats = ?, sequential_batch_size = ?, max_tickets_per_user = ?, max_tickets_per_user_total = ?, ticket_start_number = ?, public_start_at = ?, updated_at = ?
    WHERE id = ?`,
    [
      data.title,
      data.cover_image_url,
      data.cover_gif_url,
      data.price_rub,
      data.old_price_rub,
      data.ticket_count,
      data.cenopad_enabled,
      data.cenopad_price_rub,
      data.cenopad_start_at,
      data.cenopad_end_at,
      data.collection_url,
      data.tbank_collection_url,
      data.collection_recipient,
      data.sber_collection_recipient,
      data.tbank_collection_recipient,
      data.qr_image_url,
      data.qr_recipient,
      data.qr_payment_purpose,
      data.rules_url,
      data.live_stream_note,
      data.live_stream_url,
      data.live_stream_at,
      data.live_stream_status,
      data.live_stream_show_on_card,
      data.sber_enabled,
      data.tbank_enabled,
      data.qr_enabled,
      data.status,
      data.sort_order,
      data.wholesale_enabled,
      data.wholesale_every_n_tickets,
      data.card_payment_scope,
      data.card_payment_min_tickets,
      data.promo_5_plus_1_enabled,
      data.promo_5_plus_2_enabled,
      data.hidden_from_public,
      data.hide_ticket_stats,
      data.sequential_batch_size,
      data.max_tickets_per_user,
      data.max_tickets_per_user_total,
      data.ticket_start_number,
      data.public_start_at,
      Date.now(),
      id,
    ],
  );
}

export async function setRafflePromoGiftLockedCounts(
  raffleId: number,
  locked5plus1: number,
  locked5plus2: number,
): Promise<void> {
  const c1 = Math.max(0, Math.floor(Number(locked5plus1) || 0));
  const c2 = Math.max(0, Math.floor(Number(locked5plus2) || 0));
  await pgExec(
    `UPDATE raffles SET promo_5_plus_1_locked_free_count = ?, promo_5_plus_2_locked_free_count = ?, updated_at = ? WHERE id = ?`,
    [c1, c2, Date.now(), raffleId],
  );
}

export type MusicPlaybackMode = "sequential" | "shuffle";

function normalizeMusicPlaybackMode(raw: unknown): MusicPlaybackMode {
  return String(raw ?? "")
    .trim()
    .toLowerCase() === "shuffle"
    ? "shuffle"
    : "sequential";
}

export async function getSiteSettings(): Promise<{
  maintenance_enabled: boolean;
  blog_enabled: boolean;
  music_enabled: boolean;
  music_default_volume: number;
  music_playback_mode: MusicPlaybackMode;
  support_max_url: string;
}> {
  const row = await pgGet<{
    maintenance_enabled: number;
    blog_enabled?: number;
    music_enabled?: number;
    music_default_volume?: number;
    music_playback_mode?: string;
    support_max_url?: string;
  }>(
    `SELECT maintenance_enabled, blog_enabled, music_enabled, music_default_volume, music_playback_mode, support_max_url FROM site_settings WHERE id = 1`,
  );
  const vol = Math.floor(Number(row?.music_default_volume ?? 35));
  return {
    maintenance_enabled: Boolean(Number(row?.maintenance_enabled)),
    blog_enabled: Boolean(Number(row?.blog_enabled)),
    music_enabled: Boolean(Number(row?.music_enabled)),
    music_default_volume: Math.max(0, Math.min(100, Number.isFinite(vol) ? vol : 35)),
    music_playback_mode: normalizeMusicPlaybackMode(row?.music_playback_mode),
    support_max_url: normalizeSupportMaxUrl(row?.support_max_url),
  };
}

const DEFAULT_SUPPORT_MAX_URL =
  "https://max.ru/u/f9LHodD0cOKSJihr4puAfiyfPGQJWImlRAdNuRhpYwI7qse5YaB625-1d3w";

export function normalizeSupportMaxUrl(raw: unknown): string {
  const s = String(raw ?? "")
    .trim()
    .slice(0, 500);
  if (!s) return DEFAULT_SUPPORT_MAX_URL;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return DEFAULT_SUPPORT_MAX_URL;
    if (!/(^|\.)max\.ru$/i.test(u.hostname)) return DEFAULT_SUPPORT_MAX_URL;
    return u.toString();
  } catch {
    return DEFAULT_SUPPORT_MAX_URL;
  }
}

export async function setSupportMaxUrl(url: string): Promise<string> {
  const normalized = normalizeSupportMaxUrl(url);
  await pgExec(`UPDATE site_settings SET support_max_url = ? WHERE id = 1`, [normalized]);
  return normalized;
}

export async function setMaintenanceEnabled(on: boolean): Promise<void> {
  await pgExec(`UPDATE site_settings SET maintenance_enabled = ? WHERE id = 1`, [on ? 1 : 0]);
}

export async function setBlogEnabled(on: boolean): Promise<void> {
  await pgExec(`UPDATE site_settings SET blog_enabled = ? WHERE id = 1`, [on ? 1 : 0]);
}

export async function setMusicEnabled(on: boolean): Promise<void> {
  await pgExec(`UPDATE site_settings SET music_enabled = ? WHERE id = 1`, [on ? 1 : 0]);
}

export async function setMusicDefaultVolume(volume: number): Promise<void> {
  const v = Math.max(0, Math.min(100, Math.floor(Number(volume) || 0)));
  await pgExec(`UPDATE site_settings SET music_default_volume = ? WHERE id = 1`, [v]);
}

export async function setMusicPlaybackMode(mode: MusicPlaybackMode): Promise<void> {
  const m = normalizeMusicPlaybackMode(mode);
  await pgExec(`UPDATE site_settings SET music_playback_mode = ? WHERE id = 1`, [m]);
}

export async function deleteRaffle(id: number): Promise<void> {
  await pgExec(`DELETE FROM raffles WHERE id = ?`, [id]);
}

function sqlAdminThreadsSelect(extraAnd = ""): string {
  return (
    `SELECT u.id, u.phone, u.name, COALESCE(u.email,'') AS email, COALESCE(u.locality,'') AS locality, COALESCE(u.role,'user') AS role,
            COALESCE(u.blocked,0)::int AS blocked,
            (SELECT CASE
              WHEN TRIM(COALESCE(sm.body,'')) != '' THEN sm.body
              WHEN sm.attachment_url IS NOT NULL THEN '📎 Вложение'
              ELSE COALESCE(sm.body,'')
            END FROM support_messages sm WHERE sm.user_id = u.id ORDER BY sm.created_at DESC LIMIT 1) AS last_body,
            (SELECT created_at FROM support_messages sm2 WHERE sm2.user_id = u.id ORDER BY sm2.created_at DESC LIMIT 1) AS last_at,
            (SELECT is_staff FROM support_messages sm3 WHERE sm3.user_id = u.id ORDER BY sm3.created_at DESC LIMIT 1) AS last_is_staff,
            (SELECT COUNT(*)::int FROM support_messages smu WHERE smu.user_id = u.id AND smu.is_staff = 0 AND smu.read_by_staff_at IS NULL) AS unread_count
     FROM users u
     WHERE EXISTS (SELECT 1 FROM support_messages smx WHERE smx.user_id = u.id)
     ${extraAnd}
     ORDER BY COALESCE(
       (SELECT MAX(created_at) FROM support_messages sm4 WHERE sm4.user_id = u.id),
       u.created_at
     ) DESC`
  );
}

export async function listAdminThreadsWithMeta(): Promise<AdminThreadRow[]> {
  return pgAll<AdminThreadRow>(sqlAdminThreadsSelect());
}

export async function listAdminThreadsWithMetaForUserIds(userIds: number[]): Promise<AdminThreadRow[]> {
  const ids = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return [];
  const ph = ids.map((_, i) => `?`).join(",");
  return pgAll<AdminThreadRow>(sqlAdminThreadsSelect(`AND u.id IN (${ph})`), ids);
}

function supportMessageLikePattern(raw: string): string {
  return adminUserLikePattern(raw);
}

export async function searchAdminSupportThreads(raw: string): Promise<AdminThreadRow[]> {
  const q = raw.trim();
  if (!q) return listAdminThreadsWithMeta();

  const digits = q.replace(/\D/g, "");

  const norm = normalizePhone(q);
  if (norm && /^79\d{9}$/.test(norm)) {
    const row = await pgGet<{ id: number }>(
      `SELECT u.id FROM users u
       WHERE u.phone = ?
       AND EXISTS (SELECT 1 FROM support_messages sm WHERE sm.user_id = u.id)`,
      [norm],
    );
    if (row) return listAdminThreadsWithMetaForUserIds([row.id]);
  }

  if (digits.length >= 10) {
    const tail = digits.slice(-10);
    const rows = await pgAll<{ id: number }>(
      `SELECT u.id FROM users u
       WHERE EXISTS (SELECT 1 FROM support_messages sm WHERE sm.user_id = u.id)
       AND RIGHT(u.phone, 10) = ?`,
      [tail],
    );
    if (rows.length) {
      const uid = rows.map((r) => r.id);
      return listAdminThreadsWithMetaForUserIds(uid);
    }
  }

  if (q.length < 2) return [];

  const pat = supportMessageLikePattern(q);
  const msgRows = await pgAll<{ id: number }>(
    `SELECT sm.user_id AS id, MAX(sm.created_at) AS mx
     FROM support_messages sm
     WHERE lower(sm.body) LIKE lower(?) ESCAPE '\\'
     GROUP BY sm.user_id
     ORDER BY mx DESC`,
    [pat],
  );

  const orderedIds = msgRows.map((r) => r.id);
  if (!orderedIds.length) return [];

  const threads = await listAdminThreadsWithMetaForUserIds(orderedIds);
  const map = new Map(threads.map((t) => [t.id, t]));
  return orderedIds.map((id) => map.get(id)).filter((x): x is AdminThreadRow => x !== undefined);
}
