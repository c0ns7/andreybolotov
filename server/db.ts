import { randomUUID } from "node:crypto";
import { normalizePhone } from "./phone.js";
import {
  cleanupExpiredPasswordResetTokensPg,
  consumePasswordResetTokenPg,
  createSessionPg,
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

export async function countActiveAdmins(): Promise<number> {
  const r = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM users
     WHERE COALESCE(role,'user') = 'admin' AND COALESCE(blocked,0) = 0`,
  );
  return Number(r?.c ?? 0);
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

export async function updateUserRole(userId: number, role: "admin" | "user"): Promise<void> {
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

export type RaffleRow = {
  id: number;
  raffle_hash?: string;
  title: string;
  cover_image_url: string;
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
  status: string;
  sort_order: number;
  wholesale_enabled: number;
  promo_5_plus_1_enabled?: number;
  promo_5_plus_1_locked_free_count?: number;
  hidden_from_public?: number;
  launch_notify_sent_at?: number | null;
  created_at: number;
  updated_at: number;
};

export type RaffleDto = {
  id: number;
  raffle_hash: string;
  title: string;
  cover_image_url: string;
  price_rub: number;
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
  status: "active" | "closed" | "paused";
  sort_order: number;
  wholesale_enabled: boolean;
  promo_5_plus_1_enabled: boolean;
  promo_5_plus_1_locked_free_count: number;
  hidden_from_public?: boolean;
};

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
  const effectivePrice = !opts?.forAdmin && cenopadEnabled && cenopadPrice > 0 ? cenopadPrice : r.price_rub;
  const dto: RaffleDto = {
    id: r.id,
    raffle_hash: String((r as RaffleRow).raffle_hash ?? ""),
    title: r.title,
    cover_image_url: r.cover_image_url,
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
    status: st,
    sort_order: r.sort_order,
    wholesale_enabled: Boolean((r as RaffleRow).wholesale_enabled),
    promo_5_plus_1_enabled: Boolean(Number((r as RaffleRow).promo_5_plus_1_enabled ?? 0)),
    promo_5_plus_1_locked_free_count: Math.max(
      0,
      Math.floor(Number((r as RaffleRow).promo_5_plus_1_locked_free_count ?? 0)),
    ),
  };
  if (opts?.forAdmin) {
    dto.hidden_from_public = Boolean(Number((r as RaffleRow).hidden_from_public));
  }
  return dto;
}

export function isRaffleVisibleOnSite(r: RaffleRow | undefined): boolean {
  if (!r) return false;
  return !Number((r as RaffleRow).hidden_from_public);
}

export function isRaffleCenopadActive(r: RaffleRow | undefined): boolean {
  if (!r) return false;
  const enabled = Boolean(Number((r as RaffleRow).cenopad_enabled ?? 0));
  const p = Math.floor(Number((r as RaffleRow).cenopad_price_rub ?? 0));
  if (!(enabled && p > 0)) return false;
  const startAt = Math.floor(Number((r as RaffleRow).cenopad_start_at ?? 0));
  const endAt = Math.floor(Number((r as RaffleRow).cenopad_end_at ?? 0));
  const now = Date.now();
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
    `SELECT * FROM raffles WHERE COALESCE(hidden_from_public, 0) = 0 ORDER BY sort_order ASC, id DESC`,
  );
}

export async function getLatestVisibleActiveRaffle(): Promise<RaffleRow | undefined> {
  return pgGet<RaffleRow>(
    `SELECT * FROM raffles
     WHERE COALESCE(hidden_from_public, 0) = 0 AND status = 'active'
     ORDER BY id DESC
     LIMIT 1`,
  );
}

export async function getRaffleById(id: number): Promise<RaffleRow | undefined> {
  return pgGet<RaffleRow>(`SELECT * FROM raffles WHERE id = ?`, [id]);
}

export async function getRaffleByHash(hash: string): Promise<RaffleRow | undefined> {
  const h = String(hash || "").trim();
  if (!h) return undefined;
  return pgGet<RaffleRow>(`SELECT * FROM raffles WHERE raffle_hash = ?`, [h]);
}

export async function insertRaffle(data: {
  title: string;
  cover_image_url: string;
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
  status: string;
  sort_order: number;
  wholesale_enabled: number;
  promo_5_plus_1_enabled: number;
  hidden_from_public: number;
}): Promise<number> {
  const now = Date.now();
  const row = await pgGet<{ id: number }>(
    `INSERT INTO raffles (
      raffle_hash, title, cover_image_url, price_rub, cenopad_enabled, cenopad_price_rub, old_price_rub, ticket_count,
      cenopad_start_at, cenopad_end_at,
      collection_url, tbank_collection_url, collection_recipient, sber_collection_recipient, tbank_collection_recipient, qr_image_url, qr_recipient, qr_payment_purpose,
      sber_enabled, tbank_enabled, qr_enabled, rules_url, live_stream_note, live_stream_url, live_stream_at, live_stream_status,
      status, sort_order, wholesale_enabled, promo_5_plus_1_enabled, hidden_from_public, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id`,
    [
      randomUUID(),
      data.title,
      data.cover_image_url,
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
      data.status,
      data.sort_order,
      data.wholesale_enabled,
      data.promo_5_plus_1_enabled,
      data.hidden_from_public,
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
    status: string;
    sort_order: number;
    wholesale_enabled: number;
    promo_5_plus_1_enabled: number;
    hidden_from_public: number;
  },
): Promise<void> {
  await pgExec(
    `UPDATE raffles SET
      title = ?, cover_image_url = ?, price_rub = ?, old_price_rub = ?, ticket_count = ?,
      cenopad_enabled = ?, cenopad_price_rub = ?,
      cenopad_start_at = ?, cenopad_end_at = ?,
      collection_url = ?, tbank_collection_url = ?, collection_recipient = ?, sber_collection_recipient = ?, tbank_collection_recipient = ?, qr_image_url = ?, qr_recipient = ?, qr_payment_purpose = ?, rules_url = ?, live_stream_note = ?, live_stream_url = ?,
      live_stream_at = ?, live_stream_status = ?,
      sber_enabled = ?, tbank_enabled = ?, qr_enabled = ?,
      status = ?, sort_order = ?, wholesale_enabled = ?, promo_5_plus_1_enabled = ?, hidden_from_public = ?, updated_at = ?
    WHERE id = ?`,
    [
      data.title,
      data.cover_image_url,
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
      data.sber_enabled,
      data.tbank_enabled,
      data.qr_enabled,
      data.status,
      data.sort_order,
      data.wholesale_enabled,
      data.promo_5_plus_1_enabled,
      data.hidden_from_public,
      Date.now(),
      id,
    ],
  );
}

export async function setRafflePromoGiftLockedCount(raffleId: number, lockedCount: number): Promise<void> {
  const c = Math.max(0, Math.floor(Number(lockedCount) || 0));
  await pgExec(`UPDATE raffles SET promo_5_plus_1_locked_free_count = ?, updated_at = ? WHERE id = ?`, [
    c,
    Date.now(),
    raffleId,
  ]);
}

export async function getSiteSettings(): Promise<{ maintenance_enabled: boolean }> {
  const row = await pgGet<{ maintenance_enabled: number }>(
    `SELECT maintenance_enabled FROM site_settings WHERE id = 1`,
  );
  return { maintenance_enabled: Boolean(Number(row?.maintenance_enabled)) };
}

export async function setMaintenanceEnabled(on: boolean): Promise<void> {
  await pgExec(`UPDATE site_settings SET maintenance_enabled = ? WHERE id = 1`, [on ? 1 : 0]);
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
