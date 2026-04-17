import { randomBytes } from "node:crypto";
import {
  db,
  getRaffleById,
  getUserById,
  getUserByPhone,
  isRaffleVisibleOnSite,
  listRafflesAll,
} from "./db.js";
import { isValidRuMobile, normalizePhone } from "./phone.js";

export const RAFFLE_RESERVE_MS = 15 * 60 * 1000;
export const RAFFLE_MAX_SELECT = 25;

export type RaffleOrderRow = {
  id: number;
  raffle_id: number;
  user_id: number;
  bank: string | null;
  amount_rub: number;
  ticket_count: number;
  status: string;
  reserved_until: number;
  reserve_extended_once: number;
  /** epoch ms, когда отправили письмо «скоро конец брони» */
  reserve_reminder_sent_at?: number | null;
  receipt_url: string | null;
  receipt_name: string | null;
  receipt_mime: string | null;
  receipt_sha256?: string | null;
  receipt_same_as_previous?: number;
  receipt_reject_count?: number;
  last_reject_comment?: string | null;
  public_status_token?: string | null;
  created_at: number;
  updated_at: number;
};

export function newPublicOrderToken(): string {
  return randomBytes(16).toString("hex");
}

/** Сколько раз можно вернуть заявку в бронь после отклонения чека; дальше — только полная отмена. */
export function raffleMaxRejectReworksFromEnv(): number {
  const raw = String(process.env.RAFFLE_RECEIPT_REJECT_MAX ?? "3").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(Math.floor(n), 20);
}

export function insertRaffleOrderEvent(orderId: number, kind: string, detail: string | null): void {
  db.prepare(
    `INSERT INTO raffle_order_events (order_id, kind, detail, created_at) VALUES (?, ?, ?, ?)`,
  ).run(orderId, kind, detail, Date.now());
}

export type RaffleOrderTimelineItem = { kind: string; label: string; at: number; detail: string | null };

const TIMELINE_LABELS: Record<string, string> = {
  reserved: "Бронь создана",
  receipt_submitted: "Чек отправлен на проверку",
  reject_rework: "Чек не принят — нужна новая загрузка",
  fully_released: "Заявка отменена, номерки свободны",
  confirmed: "Оплата подтверждена",
  admin_ticket_removed: "Номерок снят администратором",
};

export function listRaffleOrderTimeline(orderId: number): RaffleOrderTimelineItem[] {
  const rows = db
    .prepare(
      `SELECT kind, detail, created_at FROM raffle_order_events WHERE order_id = ? ORDER BY created_at ASC`,
    )
    .all(orderId) as Array<{ kind: string; detail: string | null; created_at: number }>;
  return rows.map((r) => ({
    kind: r.kind,
    label: TIMELINE_LABELS[r.kind] ?? r.kind,
    at: r.created_at,
    detail: r.detail ?? null,
  }));
}

/** Порог «осталось не больше N минут»: 0 = выключено. */
export function reserveReminderLeadMsFromEnv(): number {
  const raw = String(process.env.RAFFLE_RESERVE_REMINDER_MINUTES ?? "5").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const capped = Math.min(Math.floor(n), 24 * 60);
  return capped * 60 * 1000;
}

export type ReserveExpiryReminderRow = {
  order_id: number;
  user_id: number;
  raffle_id: number;
  reserved_until: number;
  amount_rub: number;
  ticket_count: number;
};

/** Активные брони, по которым ещё не слали напоминание и до конца ≤ leadMs. */
export function listReservedOrdersForExpiryReminder(
  now: number,
  leadMs: number,
): ReserveExpiryReminderRow[] {
  if (leadMs <= 0) return [];
  cleanupExpiredRaffleOrders();
  const until = now + leadMs;
  const rows = db
    .prepare(
      `SELECT id AS order_id, user_id, raffle_id, reserved_until, amount_rub, ticket_count
       FROM raffle_orders
       WHERE status = 'reserved'
         AND reserved_until > ?
         AND reserved_until <= ?
         AND reserve_reminder_sent_at IS NULL`,
    )
    .all(now, until) as ReserveExpiryReminderRow[];
  return rows;
}

export function markReserveReminderSent(orderId: number): void {
  const now = Date.now();
  db.prepare(
    `UPDATE raffle_orders SET reserve_reminder_sent_at = ?, updated_at = ?
     WHERE id = ? AND status = 'reserved'`,
  ).run(now, now, orderId);
}

/** После отклонения чека: сколько минут даём на новый чек (минимум 15). */
export function rejectReopenReserveMsFromEnv(): number {
  const raw = String(process.env.RAFFLE_REJECT_REOPEN_MINUTES ?? "1440").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return 24 * 60 * 60 * 1000;
  const mins = Math.max(15, Math.min(Math.floor(n), 7 * 24 * 60));
  return mins * 60 * 1000;
}

export type TicketCellKind =
  | "free"
  | "taken"
  | "self_reserved"
  | "self_pending"
  | "self_confirmed";

export function cleanupExpiredRaffleOrders(): void {
  const now = Date.now();
  db.prepare(
    `DELETE FROM raffle_ticket_holds WHERE order_id IN (
      SELECT id FROM raffle_orders WHERE status = 'reserved' AND reserved_until < ?
    )`,
  ).run(now);
  db.prepare(
    `UPDATE raffle_orders SET status = 'expired', updated_at = ? WHERE status = 'reserved' AND reserved_until < ?`,
  ).run(now, now);
}

function getHoldForNumber(raffleId: number, ticketNumber: number) {
  return db
    .prepare(
      `SELECT h.*, o.status AS order_status, o.user_id AS order_user_id
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND h.ticket_number = ?`,
    )
    .get(raffleId, ticketNumber) as
    | {
        user_id: number;
        order_status: string;
        order_user_id: number;
        hold_status: string;
      }
    | undefined;
}

/** Занят ли номерок активной заявкой или предназначен заранее по телефону (ещё без аккаунта). */
export function isRaffleTicketBlocked(raffleId: number, ticketNumber: number): boolean {
  const held = db
    .prepare(
      `SELECT 1 FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND h.ticket_number = ? AND o.status NOT IN ('expired', 'rejected')`,
    )
    .get(raffleId, ticketNumber);
  if (held) return true;
  const pre = db
    .prepare(
      `SELECT 1 FROM raffle_phone_preassignments WHERE raffle_id = ? AND ticket_number = ?`,
    )
    .get(raffleId, ticketNumber);
  return Boolean(pre);
}

function getPreassignmentPhone(raffleId: number, ticketNumber: number): string | null {
  const row = db
    .prepare(
      `SELECT phone FROM raffle_phone_preassignments WHERE raffle_id = ? AND ticket_number = ?`,
    )
    .get(raffleId, ticketNumber) as { phone: string } | undefined;
  return row ? row.phone : null;
}

export function getTicketCellKind(
  raffleId: number,
  ticketNumber: number,
  currentUserId: number,
): TicketCellKind {
  const row = getHoldForNumber(raffleId, ticketNumber);
  if (!row) {
    const prePhone = getPreassignmentPhone(raffleId, ticketNumber);
    if (prePhone) {
      const u = getUserById(currentUserId);
      if (u && u.phone === prePhone) return "self_confirmed";
      return "taken";
    }
    return "free";
  }
  const st = row.order_status;
  if (st === "expired" || st === "rejected") return "free";
  if (row.order_user_id !== currentUserId) return "taken";
  if (st === "confirmed") return "self_confirmed";
  if (st === "pending_review") return "self_pending";
  if (st === "reserved") return "self_reserved";
  return "taken";
}

export function getTicketGridSlice(
  raffleId: number,
  userId: number,
  from: number,
  to: number,
): { cells: { n: number; kind: TicketCellKind }[]; free_count: number } {
  cleanupExpiredRaffleOrders();
  const raffle = getRaffleById(raffleId);
  if (!raffle) {
    return { cells: [], free_count: 0 };
  }
  const maxN = raffle.ticket_count;
  const a = Math.max(1, Math.floor(from));
  const b = Math.min(maxN, Math.floor(to));
  const cells: { n: number; kind: TicketCellKind }[] = [];
  for (let n = a; n <= b; n++) {
    cells.push({ n, kind: getTicketCellKind(raffleId, n, userId) });
  }
  const occupied = db
    .prepare(
      `SELECT COUNT(*) AS c FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND o.status NOT IN ('expired', 'rejected')`,
    )
    .get(raffleId) as { c: number };
  const preC = db
    .prepare(`SELECT COUNT(*) AS c FROM raffle_phone_preassignments WHERE raffle_id = ?`)
    .get(raffleId) as { c: number };
  const free_count = Math.max(0, maxN - (occupied?.c ?? 0) - (preC?.c ?? 0));
  return { cells, free_count };
}

function listNumbersWithExpiredReserveHold(raffleId: number, ticketNumbers: number[], nowMs: number): number[] {
  const out: number[] = [];
  const stmt = db.prepare(
    `SELECT 1 AS x FROM raffle_ticket_holds h
     INNER JOIN raffle_orders o ON o.id = h.order_id
     WHERE h.raffle_id = ? AND h.ticket_number = ?
       AND o.status = 'reserved' AND o.reserved_until < ?`,
  );
  for (const n of ticketNumbers) {
    if (stmt.get(raffleId, n, nowMs)) out.push(n);
  }
  return out;
}

export function createReservation(
  raffleId: number,
  userId: number,
  numbers: number[],
):
  | {
      ok: true;
      order_id: number;
      reserved_until: number;
      skipped_still_occupied: number[];
      released_after_cleanup: number[];
    }
  | { ok: false; error: string } {
  const raffle = getRaffleById(raffleId);
  if (!raffle || raffle.status !== "active") {
    return { ok: false, error: "Акция недоступна" };
  }
  if (!isRaffleVisibleOnSite(raffle)) {
    return { ok: false, error: "Акция недоступна" };
  }
  const existingOrder = db
    .prepare(
      `SELECT id FROM raffle_orders WHERE raffle_id = ? AND user_id = ? AND status IN ('reserved', 'pending_review')`,
    )
    .get(raffleId, userId) as { id: number } | undefined;
  if (existingOrder) {
    return {
      ok: false,
      error:
        "У вас уже есть активная заявка по этой акции. Завершите оплату или дождитесь проверки.",
    };
  }
  const uniq = [...new Set(numbers.map((x) => Math.floor(Number(x))))].filter((n) =>
    Number.isFinite(n),
  );
  uniq.sort((x, y) => x - y);
  if (uniq.length < 1 || uniq.length > RAFFLE_MAX_SELECT) {
    return { ok: false, error: `Выберите от 1 до ${RAFFLE_MAX_SELECT} номерков` };
  }
  for (const n of uniq) {
    if (n < 1 || n > raffle.ticket_count) {
      return { ok: false, error: "Некорректный номер" };
    }
  }

  const now = Date.now();
  const hadExpiredReserveHold = listNumbersWithExpiredReserveHold(raffleId, uniq, now);
  cleanupExpiredRaffleOrders();

  const skipped_still_occupied = uniq.filter((n) => isRaffleTicketBlocked(raffleId, n));
  const released_after_cleanup = hadExpiredReserveHold.filter((n) => !isRaffleTicketBlocked(raffleId, n));
  const toReserve = uniq.filter((n) => !isRaffleTicketBlocked(raffleId, n));

  if (toReserve.length === 0) {
    const sample = skipped_still_occupied.slice(0, 8).join(", ");
    const tail = skipped_still_occupied.length > 8 ? "…" : "";
    return {
      ok: false,
      error:
        skipped_still_occupied.length > 0
          ? `Выбранные номерки уже заняты: ${sample}${tail}. Обновите сетку и выберите свободные.`
          : "Не удалось забронировать номерки. Попробуйте снова.",
    };
  }

  const reservedUntil = now + RAFFLE_RESERVE_MS;
  const amount = toReserve.length * raffle.price_rub;

  try {
    const tx = db.transaction(() => {
      for (const n of toReserve) {
        if (isRaffleTicketBlocked(raffleId, n)) throw new Error("OCCUPIED");
      }
      const pubTok = newPublicOrderToken();
      const info = db
        .prepare(
          `INSERT INTO raffle_orders (
            raffle_id, user_id, bank, amount_rub, ticket_count, status,
            reserved_until, receipt_url, receipt_name, receipt_mime, public_status_token, created_at, updated_at
          ) VALUES (?, ?, NULL, ?, ?, 'reserved', ?, NULL, NULL, NULL, ?, ?, ?)`,
        )
        .run(
          raffleId,
          userId,
          amount,
          toReserve.length,
          reservedUntil,
          pubTok,
          now,
          now,
        );
      const orderId = Number(info.lastInsertRowid);
      insertRaffleOrderEvent(orderId, "reserved", null);
      const ins = db.prepare(
        `INSERT INTO raffle_ticket_holds (raffle_id, order_id, user_id, ticket_number, hold_status, expires_at, created_at)
         VALUES (?, ?, ?, ?, 'reserved', ?, ?)`,
      );
      for (const n of toReserve) {
        ins.run(raffleId, orderId, userId, n, reservedUntil, now);
      }
      return orderId;
    });
    const orderId = tx();
    return {
      ok: true,
      order_id: orderId,
      reserved_until: reservedUntil,
      skipped_still_occupied,
      released_after_cleanup,
    };
  } catch (e) {
    if (e instanceof Error && e.message === "OCCUPIED") {
      return { ok: false, error: "Один или несколько номерков уже заняты — обновите страницу и попробуйте снова." };
    }
    throw e;
  }
}

export function getActiveOrderForUser(
  raffleId: number,
  userId: number,
): RaffleOrderRow | undefined {
  cleanupExpiredRaffleOrders();
  return db
    .prepare(
      `SELECT * FROM raffle_orders WHERE raffle_id = ? AND user_id = ? AND status IN ('reserved', 'pending_review') ORDER BY id DESC LIMIT 1`,
    )
    .get(raffleId, userId) as RaffleOrderRow | undefined;
}

export function getOrderByIdForUser(
  orderId: number,
  userId: number,
): RaffleOrderRow | undefined {
  cleanupExpiredRaffleOrders();
  return db
    .prepare(`SELECT * FROM raffle_orders WHERE id = ? AND user_id = ?`)
    .get(orderId, userId) as RaffleOrderRow | undefined;
}

export function getOrderById(orderId: number): RaffleOrderRow | undefined {
  return db.prepare(`SELECT * FROM raffle_orders WHERE id = ?`).get(orderId) as
    | RaffleOrderRow
    | undefined;
}

export function setOrderBank(
  orderId: number,
  userId: number,
  bank: "sber" | "other",
): { ok: true } | { ok: false; error: string } {
  cleanupExpiredRaffleOrders();
  const o = getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Статус не позволяет изменить банк" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const now = Date.now();
  db.prepare(`UPDATE raffle_orders SET bank = ?, updated_at = ? WHERE id = ?`).run(
    bank,
    now,
    orderId,
  );
  return { ok: true };
}

export function attachReceiptToOrder(
  orderId: number,
  userId: number,
  receipt: { url: string; name: string; mime: string; sha256?: string },
): { ok: true } | { ok: false; error: string } {
  cleanupExpiredRaffleOrders();
  if (!/^\/uploads\/receipts\/[a-zA-Z0-9._-]+$/.test(receipt.url)) {
    return { ok: false, error: "Некорректная ссылка на чек" };
  }
  const sha = String(receipt.sha256 || "")
    .trim()
    .toLowerCase();
  if (!sha) return { ok: false, error: "Не передан отпечаток файла (sha256)" };
  if (sha && !/^[a-f0-9]{64}$/.test(sha)) {
    return { ok: false, error: "Некорректный отпечаток файла" };
  }
  const o = getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Чек можно прикрепить только к активной брони" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const prevSha = String((o as RaffleOrderRow).receipt_sha256 || "")
    .trim()
    .toLowerCase();
  if (sha && prevSha && sha === prevSha) {
    return { ok: false, error: "Этот чек уже прикреплён к данной заявке" };
  }

  const now = Date.now();

  if (sha) {
    // Защита от повторного использования чека (даже другим человеком на другой заявке).
    // Храним использованные отпечатки отдельно, чтобы если заявка ушла на доработку,
    // то заменяемый чек не давал обойти защиту.
    const ins = db.prepare(
      `INSERT OR IGNORE INTO used_receipts (sha256, first_order_id, created_at) VALUES (?, ?, ?)`,
    );
    const info = ins.run(sha, orderId, now);
    if (!info || Number(info.changes) === 0) {
      return { ok: false, error: "Этот чек уже использован ранее" };
    }
  }

  const isSameAsPrevious = 0;
  db.prepare(
    `UPDATE raffle_orders
     SET receipt_url = ?, receipt_name = ?, receipt_mime = ?, receipt_sha256 = ?, receipt_same_as_previous = ?,
         status = 'pending_review', updated_at = ?
     WHERE id = ?`,
  ).run(receipt.url, receipt.name, receipt.mime, sha || null, isSameAsPrevious, now, orderId);
  db.prepare(
    `UPDATE raffle_ticket_holds SET hold_status = 'payment_pending', expires_at = NULL WHERE order_id = ?`,
  ).run(orderId);
  insertRaffleOrderEvent(orderId, "receipt_submitted", null);
  return { ok: true };
}

export type PendingPaymentRow = RaffleOrderRow & { raffle_title: string; user_phone: string; user_name: string };

export function listPendingPayments(): PendingPaymentRow[] {
  return db
    .prepare(
      `SELECT o.*, r.title AS raffle_title, u.phone AS user_phone, u.name AS user_name
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       INNER JOIN users u ON u.id = o.user_id
       WHERE o.status = 'pending_review'
       ORDER BY o.created_at ASC`,
    )
    .all() as PendingPaymentRow[];
}

export function confirmOrderByAdmin(orderId: number): { ok: true } | { ok: false; error: string } {
  const o = getOrderById(orderId);
  if (!o) return { ok: false, error: "Не найдено" };
  if (o.status !== "pending_review") return { ok: false, error: "Неверный статус" };
  const now = Date.now();
  const raffleId = o.raffle_id;
  db.prepare(
    `UPDATE raffle_orders SET status = 'confirmed', receipt_reject_count = 0, last_reject_comment = NULL, updated_at = ? WHERE id = ?`,
  ).run(now, orderId);
  db.prepare(
    `UPDATE raffle_ticket_holds SET hold_status = 'confirmed' WHERE order_id = ?`,
  ).run(orderId);
  insertRaffleOrderEvent(orderId, "confirmed", null);
  recalculateWholesaleForRaffle(raffleId);
  return { ok: true };
}

/** Полностью снять бронь / отменить заявку: номерки освобождаются. */
export function adminFullyReleaseRaffleOrder(
  orderId: number,
  eventDetail: string | null = null,
): { ok: true } | { ok: false; error: string } {
  const o = getOrderById(orderId);
  if (!o) return { ok: false, error: "Не найдено" };
  if (o.status !== "reserved" && o.status !== "pending_review") {
    return { ok: false, error: "Можно снять только активную бронь или заявку на проверке" };
  }
  const now = Date.now();
  const raffleId = o.raffle_id;
  db.prepare(`DELETE FROM raffle_ticket_holds WHERE order_id = ?`).run(orderId);
  db.prepare(
    `UPDATE raffle_orders SET status = 'rejected', receipt_url = NULL, receipt_name = NULL, receipt_mime = NULL, updated_at = ? WHERE id = ?`,
  ).run(now, orderId);
  insertRaffleOrderEvent(orderId, "fully_released", eventDetail);
  recalculateWholesaleForRaffle(raffleId);
  return { ok: true };
}

export function rejectOrderByAdmin(
  orderId: number,
  opts?: { adminNote?: string },
):
  | { ok: true; mode: "rework" | "fully_released" }
  | { ok: false; error: string } {
  const o = getOrderById(orderId);
  if (!o) return { ok: false, error: "Не найдено" };
  if (o.status !== "pending_review") return { ok: false, error: "Неверный статус" };
  const note = String(opts?.adminNote ?? "").trim().slice(0, 500);
  const count = Number((o as RaffleOrderRow).receipt_reject_count ?? 0);
  const max = raffleMaxRejectReworksFromEnv();
  if (count >= max) {
    const detail = note || `Достигнут лимит доработок чека (${max})`;
    const r = adminFullyReleaseRaffleOrder(orderId, detail);
    if (!r.ok) return r;
    if (note) {
      db.prepare(`UPDATE raffle_orders SET last_reject_comment = ?, updated_at = ? WHERE id = ?`).run(
        note,
        Date.now(),
        orderId,
      );
    }
    return { ok: true, mode: "fully_released" };
  }
  const now = Date.now();
  const raffleId = o.raffle_id;
  const newUntil = now + rejectReopenReserveMsFromEnv();
  db.prepare(
    `UPDATE raffle_orders SET status = 'reserved', receipt_url = NULL, receipt_name = NULL, receipt_mime = NULL,
     reserved_until = ?, reserve_extended_once = 0, reserve_reminder_sent_at = NULL,
     receipt_reject_count = COALESCE(receipt_reject_count, 0) + 1, last_reject_comment = ?, updated_at = ? WHERE id = ?`,
  ).run(newUntil, note || null, now, orderId);
  db.prepare(
    `UPDATE raffle_ticket_holds SET hold_status = 'reserved', expires_at = ? WHERE order_id = ?`,
  ).run(newUntil, orderId);
  insertRaffleOrderEvent(orderId, "reject_rework", note || null);
  recalculateWholesaleForRaffle(raffleId);
  return { ok: true, mode: "rework" };
}

export type AdminActiveOrderRow = RaffleOrderRow & {
  raffle_title: string;
  user_phone: string;
  user_name: string;
};

export function listActiveOrdersForAdmin(): AdminActiveOrderRow[] {
  cleanupExpiredRaffleOrders();
  const now = Date.now();
  return db
    .prepare(
      `SELECT o.*, r.title AS raffle_title, u.phone AS user_phone, u.name AS user_name
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       INNER JOIN users u ON u.id = o.user_id
       WHERE o.status = 'reserved' AND o.reserved_until > ?
       ORDER BY o.reserved_until ASC
       LIMIT 300`,
    )
    .all(now) as AdminActiveOrderRow[];
}

export type PublicOrderStatusDto = {
  found: boolean;
  order_public_id: string;
  status: string;
  raffle_title: string;
  rules_url: string | null;
  amount_rub: number;
  ticket_count: number;
  reserved_until: number | null;
  timeline: RaffleOrderTimelineItem[];
  review_eta_hint: string;
};

export function receiptReviewEtaHintFromEnv(): string {
  const raw = String(process.env.RAFFLE_RECEIPT_REVIEW_HOURS ?? "24").trim();
  const n = Number(raw);
  const h = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 168) : 24;
  return `Обычно проверка занимает до ${h} ч.`;
}

export function getPublicOrderStatusByToken(rawToken: string): PublicOrderStatusDto | null {
  const t = String(rawToken ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(t)) return null;
  const o = db
    .prepare(`SELECT * FROM raffle_orders WHERE public_status_token = ?`)
    .get(t) as RaffleOrderRow | undefined;
  if (!o) return null;
  const raffle = getRaffleById(o.raffle_id);
  const title = raffle ? raffle.title : "Акция";
  const rulesRaw = raffle ? String(raffle.rules_url ?? "").trim() : "";
  return {
    found: true,
    order_public_id: `A${o.id}`,
    status: o.status,
    raffle_title: title,
    rules_url: rulesRaw ? rulesRaw : null,
    amount_rub: o.amount_rub,
    ticket_count: o.ticket_count,
    reserved_until: o.status === "reserved" ? o.reserved_until : null,
    timeline: listRaffleOrderTimeline(o.id),
    review_eta_hint: receiptReviewEtaHintFromEnv(),
  };
}

export function orderToDto(o: RaffleOrderRow) {
  const tok = String((o as RaffleOrderRow).public_status_token ?? "").trim();
  return {
    id: o.id,
    raffle_id: o.raffle_id,
    bank: o.bank,
    amount_rub: o.amount_rub,
    ticket_count: o.ticket_count,
    status: o.status,
    reserved_until: o.reserved_until,
    reserve_extended_once: (o as RaffleOrderRow).reserve_extended_once ? 1 : 0,
    receipt_url: o.receipt_url,
    receipt_name: o.receipt_name,
    receipt_same_as_previous: Number((o as RaffleOrderRow).receipt_same_as_previous ?? 0),
    receipt_reject_count: Number((o as RaffleOrderRow).receipt_reject_count ?? 0),
    last_reject_comment: (o as RaffleOrderRow).last_reject_comment ?? null,
    tracking_token: tok || null,
    receipt_review_eta_hint: receiptReviewEtaHintFromEnv(),
    created_at: o.created_at,
  };
}

const RESERVE_EXTEND_MS = 10 * 60 * 1000;

/** Одно продление брони на +10 мин (поле reserve_extended_once). */
export function extendReservedOrderOnce(
  orderId: number,
  userId: number,
):
  | { ok: true; order: ReturnType<typeof orderToDto> }
  | { ok: false; error: string } {
  cleanupExpiredRaffleOrders();
  const o = getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Нельзя продлить эту заявку" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  if (Number((o as { reserve_extended_once?: number }).reserve_extended_once))
    return { ok: false, error: "Продление уже использовано" };
  const now = Date.now();
  const newUntil = o.reserved_until + RESERVE_EXTEND_MS;
  db.prepare(
    `UPDATE raffle_orders SET reserved_until = ?, reserve_extended_once = 1, reserve_reminder_sent_at = NULL, updated_at = ? WHERE id = ?`,
  ).run(newUntil, now, orderId);
  db.prepare(`UPDATE raffle_ticket_holds SET expires_at = ? WHERE order_id = ?`).run(newUntil, orderId);
  const updated = getOrderByIdForUser(orderId, userId);
  if (!updated) return { ok: false, error: "Ошибка" };
  return { ok: true, order: orderToDto(updated) };
}

export function getTicketNumbersForOrder(orderId: number): number[] {
  const rows = db
    .prepare(
      `SELECT ticket_number FROM raffle_ticket_holds WHERE order_id = ? ORDER BY ticket_number ASC`,
    )
    .all(orderId) as { ticket_number: number }[];
  return rows.map((r) => r.ticket_number);
}

export function listReservedOrdersForUser(userId: number): Array<{
  order: ReturnType<typeof orderToDto>;
  numbers: number[];
  timeline: RaffleOrderTimelineItem[];
  raffle: { id: number; title: string; price_rub: number };
}> {
  cleanupExpiredRaffleOrders();
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.status = 'reserved' AND o.reserved_until > ?
         AND COALESCE(r.hidden_from_public, 0) = 0
       ORDER BY o.id DESC`,
    )
    .all(userId, now) as Array<RaffleOrderRow & { raffle_title: string; raffle_price: number }>;
  return rows.map((row) => ({
    order: orderToDto(row),
    numbers: getTicketNumbersForOrder(row.id),
    timeline: listRaffleOrderTimeline(row.id),
    raffle: {
      id: row.raffle_id,
      title: row.raffle_title,
      price_rub: row.raffle_price,
    },
  }));
}

export function removeTicketFromReservedOrder(
  orderId: number,
  userId: number,
  ticketNumber: number,
):
  | { ok: true; order: ReturnType<typeof orderToDto> | null; numbers: number[] }
  | { ok: false; error: string } {
  cleanupExpiredRaffleOrders();
  const o = getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Нельзя изменить заявку" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const raffle = getRaffleById(o.raffle_id);
  if (!raffle) return { ok: false, error: "Акция не найдена" };

  const del = db
    .prepare(`DELETE FROM raffle_ticket_holds WHERE order_id = ? AND ticket_number = ?`)
    .run(orderId, ticketNumber);
  if (del.changes === 0) return { ok: false, error: "Номерок не в заявке" };

  const nums = getTicketNumbersForOrder(orderId);
  const now = Date.now();
  if (nums.length === 0) {
    db.prepare(`DELETE FROM raffle_orders WHERE id = ?`).run(orderId);
    return { ok: true, order: null, numbers: [] };
  }
  const amount = nums.length * raffle.price_rub;
  db.prepare(
    `UPDATE raffle_orders SET amount_rub = ?, ticket_count = ?, updated_at = ? WHERE id = ?`,
  ).run(amount, nums.length, now, orderId);
  const updated = getOrderByIdForUser(orderId, userId);
  return {
    ok: true,
    order: updated ? orderToDto(updated) : null,
    numbers: nums,
  };
}

/**
 * Админ: снять номерок с участника по номеру (предназначение до регистрации, бронь, на проверке, подтверждённый).
 * Номер снова становится свободным; при пустом заказе запись заказа удаляется.
 */
export function adminDetachParticipantTicket(
  raffleId: number,
  ticketNumber: number,
):
  | { ok: true; affected_user_id: number | null }
  | { ok: false; error: string } {
  cleanupExpiredRaffleOrders();
  const raffle = getRaffleById(raffleId);
  if (!raffle) return { ok: false, error: "Акция не найдена" };
  const n = Math.floor(Number(ticketNumber));
  if (!Number.isFinite(n) || n < 1 || n > raffle.ticket_count) {
    return { ok: false, error: "Некорректный номерок" };
  }

  const pre = db
    .prepare(`DELETE FROM raffle_phone_preassignments WHERE raffle_id = ? AND ticket_number = ?`)
    .run(raffleId, n);
  if (pre.changes > 0) {
    return { ok: true, affected_user_id: null };
  }

  const row = db
    .prepare(
      `SELECT h.order_id AS order_id, o.user_id AS user_id
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND h.ticket_number = ? AND o.status NOT IN ('expired', 'rejected')`,
    )
    .get(raffleId, n) as { order_id: number; user_id: number } | undefined;

  if (!row) return { ok: false, error: "Номерок не занят или уже снят" };

  const orderId = row.order_id;
  const affectedUserId = row.user_id;
  const now = Date.now();

  try {
    const tx = db.transaction(() => {
      const del = db
        .prepare(`DELETE FROM raffle_ticket_holds WHERE order_id = ? AND ticket_number = ?`)
        .run(orderId, n);
      if (del.changes === 0) throw new Error("HOLD_MISSING");

      const nums = getTicketNumbersForOrder(orderId);
      if (nums.length === 0) {
        db.prepare(`DELETE FROM raffle_orders WHERE id = ?`).run(orderId);
      } else {
        const amount = nums.length * raffle.price_rub;
        db.prepare(
          `UPDATE raffle_orders SET amount_rub = ?, ticket_count = ?, updated_at = ? WHERE id = ?`,
        ).run(amount, nums.length, now, orderId);
        insertRaffleOrderEvent(orderId, "admin_ticket_removed", "№ " + String(n));
      }
    });
    tx();
  } catch {
    return { ok: false, error: "Не удалось снять номерок" };
  }

  recalculateWholesaleForRaffle(raffleId);
  return { ok: true, affected_user_id: affectedUserId };
}

export function listConfirmedTicketGroupsForUser(userId: number): Array<{
  order: ReturnType<typeof orderToDto>;
  numbers: number[];
  timeline: RaffleOrderTimelineItem[];
  raffle: { id: number; title: string; price_rub: number; status: string };
}> {
  const rows = db
    .prepare(
      `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price, r.status AS raffle_status
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.status = 'confirmed'
         AND COALESCE(r.hidden_from_public, 0) = 0
       ORDER BY o.id DESC`,
    )
    .all(userId) as Array<
    RaffleOrderRow & { raffle_title: string; raffle_price: number; raffle_status: string }
  >;
  return rows.map((row) => ({
    order: orderToDto(row),
    numbers: getTicketNumbersForOrder(row.id),
    timeline: listRaffleOrderTimeline(row.id),
    raffle: {
      id: row.raffle_id,
      title: row.raffle_title,
      price_rub: row.raffle_price,
      status: String(row.raffle_status || "active"),
    },
  }));
}

export function listPendingReviewTicketGroupsForUser(userId: number): Array<{
  order: ReturnType<typeof orderToDto>;
  numbers: number[];
  timeline: RaffleOrderTimelineItem[];
  raffle: { id: number; title: string; price_rub: number; status: string };
}> {
  const rows = db
    .prepare(
      `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price, r.status AS raffle_status
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.status = 'pending_review'
         AND COALESCE(r.hidden_from_public, 0) = 0
       ORDER BY o.id DESC`,
    )
    .all(userId) as Array<
    RaffleOrderRow & { raffle_title: string; raffle_price: number; raffle_status: string }
  >;
  return rows.map((row) => ({
    order: orderToDto(row),
    numbers: getTicketNumbersForOrder(row.id),
    timeline: listRaffleOrderTimeline(row.id),
    raffle: {
      id: row.raffle_id,
      title: row.raffle_title,
      price_rub: row.raffle_price,
      status: String(row.raffle_status || "active"),
    },
  }));
}

/**
 * Админ: билеты пользователя по «текущей» акции — первая в списке как в админке/на главной
 * (sort_order ASC, id DESC), в т.ч. если акция скрыта с сайта.
 */
export function adminUserTicketsForPrimaryRaffle(userId: number): {
  raffle: { id: number; title: string; status: string } | null;
  reserved: ReturnType<typeof listReservedOrdersForUser>;
  pending_review: ReturnType<typeof listPendingReviewTicketGroupsForUser>;
  confirmed: ReturnType<typeof listConfirmedTicketGroupsForUser>;
} {
  cleanupExpiredRaffleOrders();
  const now = Date.now();
  const raffles = listRafflesAll();
  const raffle = raffles[0];
  if (!raffle) {
    return { raffle: null, reserved: [], pending_review: [], confirmed: [] };
  }
  const rid = raffle.id;

  const reservedRows = db
    .prepare(
      `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.raffle_id = ? AND o.status = 'reserved' AND o.reserved_until > ?
       ORDER BY o.id DESC`,
    )
    .all(userId, rid, now) as Array<RaffleOrderRow & { raffle_title: string; raffle_price: number }>;

  const reserved = reservedRows.map((row) => ({
    order: orderToDto(row),
    numbers: getTicketNumbersForOrder(row.id),
    timeline: listRaffleOrderTimeline(row.id),
    raffle: {
      id: row.raffle_id,
      title: row.raffle_title,
      price_rub: row.raffle_price,
    },
  }));

  const pendingRows = db
    .prepare(
      `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price, r.status AS raffle_status
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.raffle_id = ? AND o.status = 'pending_review'
       ORDER BY o.id DESC`,
    )
    .all(userId, rid) as Array<
    RaffleOrderRow & { raffle_title: string; raffle_price: number; raffle_status: string }
  >;

  const pending_review = pendingRows.map((row) => ({
    order: orderToDto(row),
    numbers: getTicketNumbersForOrder(row.id),
    timeline: listRaffleOrderTimeline(row.id),
    raffle: {
      id: row.raffle_id,
      title: row.raffle_title,
      price_rub: row.raffle_price,
      status: String(row.raffle_status || "active"),
    },
  }));

  const confirmedRows = db
    .prepare(
      `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price, r.status AS raffle_status
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.raffle_id = ? AND o.status = 'confirmed'
       ORDER BY o.id DESC`,
    )
    .all(userId, rid) as Array<
    RaffleOrderRow & { raffle_title: string; raffle_price: number; raffle_status: string }
  >;

  const confirmed = confirmedRows.map((row) => ({
    order: orderToDto(row),
    numbers: getTicketNumbersForOrder(row.id),
    timeline: listRaffleOrderTimeline(row.id),
    raffle: {
      id: row.raffle_id,
      title: row.raffle_title,
      price_rub: row.raffle_price,
      status: String(row.raffle_status || "active"),
    },
  }));

  return {
    raffle: {
      id: raffle.id,
      title: raffle.title,
      status: String(raffle.status || "active"),
    },
    reserved,
    pending_review,
    confirmed,
  };
}

/** Пересчёт номеров оптовиков: каждые 10 подтверждённых номерков в акции дают следующий глобальный № по времени подтверждения заказов. */
export function recalculateWholesaleForRaffle(raffleId: number): void {
  const raffle = getRaffleById(raffleId);
  if (!raffle) return;
  db.prepare(`DELETE FROM raffle_wholesale_assignments WHERE raffle_id = ?`).run(raffleId);
  if (!Number(raffle.wholesale_enabled)) return;

  const rows = db
    .prepare(
      `SELECT h.user_id AS user_id, h.ticket_number AS ticket_number, o.updated_at AS ord_u, o.id AS oid
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND o.status = 'confirmed'
       ORDER BY o.updated_at ASC, o.id ASC, h.ticket_number ASC`,
    )
    .all(raffleId) as Array<{ user_id: number; ticket_number: number; ord_u: number; oid: number }>;

  const perUser = new Map<number, number>();
  let globalN = 0;
  const now = Date.now();
  const ins = db.prepare(
    `INSERT INTO raffle_wholesale_assignments (raffle_id, user_id, user_slot_index, wholesale_number, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );

  for (const row of rows) {
    const uid = row.user_id;
    const c = (perUser.get(uid) ?? 0) + 1;
    perUser.set(uid, c);
    if (c % 10 !== 0) continue;
    globalN += 1;
    const slotIdx = c / 10;
    ins.run(raffleId, uid, slotIdx, globalN, now);
  }
}

export type AdminWholesalerRow = {
  wholesale_number: number;
  user_phone: string;
};

export type AdminRaffleParticipantView = {
  ticket_number: number;
  user_phone: string;
  order_status: string;
  is_wholesale: boolean;
  user_id: number;
  user_name: string;
  user_email: string;
};

/** Подтверждённые номерки без оплаты (админ): одна или несколько записей в одном заказе. */
export function createOrAppendConfirmedTicketsForUser(
  raffleId: number,
  userId: number,
  numbers: number[],
): void {
  const raffle = getRaffleById(raffleId);
  if (!raffle) throw new Error("NO_RAFFLE");
  const uniq = [...new Set(numbers.map((x) => Math.floor(Number(x))))].filter((n) => Number.isFinite(n));
  uniq.sort((a, b) => a - b);
  if (uniq.length === 0) return;
  for (const n of uniq) {
    if (n < 1 || n > raffle.ticket_count) throw new Error("BAD_NUM");
  }
  const now = Date.now();
  const existing = db
    .prepare(
      `SELECT id, ticket_count, amount_rub FROM raffle_orders WHERE raffle_id = ? AND user_id = ? AND status = 'confirmed' ORDER BY id DESC LIMIT 1`,
    )
    .get(raffleId, userId) as { id: number; ticket_count: number; amount_rub: number } | undefined;

  const insHold = db.prepare(
    `INSERT INTO raffle_ticket_holds (raffle_id, order_id, user_id, ticket_number, hold_status, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'confirmed', NULL, ?)`,
  );

  if (existing) {
    const existingNums = new Set(getTicketNumbersForOrder(existing.id));
    const toAdd = uniq.filter((n) => !existingNums.has(n));
    if (toAdd.length === 0) return;
    for (const n of toAdd) {
      if (isRaffleTicketBlocked(raffleId, n)) throw new Error("OCCUPIED");
    }
    for (const n of toAdd) {
      insHold.run(raffleId, existing.id, userId, n, now);
    }
    const totalCount = existing.ticket_count + toAdd.length;
    const amount = totalCount * raffle.price_rub;
    db.prepare(`UPDATE raffle_orders SET amount_rub = ?, ticket_count = ?, updated_at = ? WHERE id = ?`).run(
      amount,
      totalCount,
      now,
      existing.id,
    );
    return;
  }

  for (const n of uniq) {
    if (isRaffleTicketBlocked(raffleId, n)) throw new Error("OCCUPIED");
  }
  const amount = uniq.length * raffle.price_rub;
  const pubTok = newPublicOrderToken();
  const info = db
    .prepare(
      `INSERT INTO raffle_orders (
        raffle_id, user_id, bank, amount_rub, ticket_count, status,
        reserved_until, receipt_url, receipt_name, receipt_mime, public_status_token, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, 'confirmed', 0, NULL, NULL, NULL, ?, ?, ?)`,
    )
    .run(raffleId, userId, amount, uniq.length, pubTok, now, now);
  const orderId = Number(info.lastInsertRowid);
  insertRaffleOrderEvent(orderId, "confirmed", null);
  for (const n of uniq) {
    insHold.run(raffleId, orderId, userId, n, now);
  }
}

/** Перенос предназначенных по телефону номерков в реальные подтверждённые заявки после регистрации/входа. Возвращает id акций, где что-то изменилось. */
export function materializeRafflePreassignmentsForUser(userId: number): number[] {
  const u = getUserById(userId);
  if (!u) return [];
  const phone = u.phone;
  const rows = db
    .prepare(`SELECT raffle_id, ticket_number FROM raffle_phone_preassignments WHERE phone = ?`)
    .all(phone) as Array<{ raffle_id: number; ticket_number: number }>;
  if (!rows.length) return [];

  const byRaffle = new Map<number, number[]>();
  for (const r of rows) {
    const arr = byRaffle.get(r.raffle_id) ?? [];
    arr.push(r.ticket_number);
    byRaffle.set(r.raffle_id, arr);
  }

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM raffle_phone_preassignments WHERE phone = ?`).run(phone);
    for (const [raffleId, nums] of byRaffle) {
      nums.sort((a, b) => a - b);
      createOrAppendConfirmedTicketsForUser(raffleId, userId, nums);
    }
    for (const raffleId of byRaffle.keys()) {
      recalculateWholesaleForRaffle(raffleId);
    }
  });
  tx();
  return [...byRaffle.keys()];
}

export type BulkAssignSkip = {
  line: number;
  phone: string;
  ticket_number: number;
  reason: string;
};

/** У телефона уже есть любой номерок в этой акции (бронь / проверка / подтверждённый или предназначение до регистрации). */
function phoneHasAssignmentInRaffle(raffleId: number, phone: string): boolean {
  const pre = db
    .prepare(`SELECT 1 FROM raffle_phone_preassignments WHERE raffle_id = ? AND phone = ? LIMIT 1`)
    .get(raffleId, phone);
  if (pre) return true;
  const row = db
    .prepare(
      `SELECT 1 FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       INNER JOIN users u ON u.id = h.user_id
       WHERE h.raffle_id = ? AND u.phone = ? AND o.status NOT IN ('expired', 'rejected')
       LIMIT 1`,
    )
    .get(raffleId, phone);
  return Boolean(row);
}

/**
 * Одна строка — один телефон; желаемый номерок = start + индекс строки среди непустых.
 * Если занят — берём следующий свободный до max.
 * Если у телефона уже есть номерок в акции или он уже получил номер в этой загрузке — строка пропускается (без второго номерка).
 */
export function adminBulkAssignPhoneLinesToRaffle(
  raffleId: number,
  rawLines: string[],
  startNumber: number,
): { ok: true; assigned: number; skipped: BulkAssignSkip[] } | { ok: false; error: string } {
  const raffle = getRaffleById(raffleId);
  if (!raffle) return { ok: false, error: "Акция не найдена" };
  const maxN = raffle.ticket_count;
  const start = Math.max(1, Math.floor(Number(startNumber)) || 1);

  type Parsed = { line: number; phone: string; idealFirst: number };
  const parsed: Parsed[] = [];
  let nonEmptyIndex = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const line = i + 1;
    const raw = String(rawLines[i] ?? "").trim();
    if (!raw) continue;
    const phone = normalizePhone(raw);
    if (!phone || !isValidRuMobile(phone)) {
      return { ok: false, error: "Строка " + line + ": некорректный мобильный телефон РФ" };
    }
    const idealFirst = start + nonEmptyIndex;
    nonEmptyIndex += 1;
    parsed.push({ line, phone, idealFirst });
  }

  if (parsed.length === 0) return { ok: false, error: "Нет ни одной строки с телефоном" };

  type Entry = { line: number; phone: string; ticket_number: number };
  const skipped: BulkAssignSkip[] = [];
  /** Номерки, выбранные в этой загрузке (пока не в БД). */
  const virt = new Set<number>();
  const valid: Entry[] = [];
  /** Первое вхождение телефона в файле — дальше строки с тем же номером пропускаем. */
  const seenPhoneInFile = new Set<string>();

  for (const p of parsed) {
    if (seenPhoneInFile.has(p.phone)) {
      skipped.push({
        line: p.line,
        phone: p.phone,
        ticket_number: p.idealFirst,
        reason: "Повтор телефона в списке — одному номеру один номерок за загрузку",
      });
      continue;
    }
    seenPhoneInFile.add(p.phone);

    if (phoneHasAssignmentInRaffle(raffleId, p.phone)) {
      skipped.push({
        line: p.line,
        phone: p.phone,
        ticket_number: p.idealFirst,
        reason: "Уже есть номерок в этой акции",
      });
      continue;
    }

    let found: number | null = null;
    for (let cand = p.idealFirst; cand <= maxN; cand++) {
      if (!virt.has(cand) && !isRaffleTicketBlocked(raffleId, cand)) {
        found = cand;
        break;
      }
    }
    if (found == null) {
      skipped.push({
        line: p.line,
        phone: p.phone,
        ticket_number: p.idealFirst,
        reason: "Нет свободных номерков начиная с " + p.idealFirst,
      });
      continue;
    }

    virt.add(found);
    valid.push({ line: p.line, phone: p.phone, ticket_number: found });
  }

  if (!valid.length) return { ok: true, assigned: 0, skipped };

  const byPhone = new Map<string, Entry[]>();
  for (const e of valid) {
    const arr = byPhone.get(e.phone) ?? [];
    arr.push(e);
    byPhone.set(e.phone, arr);
  }

  const tx = db.transaction(() => {
    for (const [, list] of byPhone) {
      list.sort((a, b) => a.ticket_number - b.ticket_number);
      const tickets = list.map((x) => x.ticket_number);
      const phone = list[0]!.phone;
      const user = getUserByPhone(phone);
      if (user) {
        createOrAppendConfirmedTicketsForUser(raffleId, user.id, tickets);
      } else {
        const now = Date.now();
        const ins = db.prepare(
          `INSERT INTO raffle_phone_preassignments (raffle_id, ticket_number, phone, created_at) VALUES (?, ?, ?, ?)`,
        );
        for (const t of tickets) {
          ins.run(raffleId, t, phone, now);
        }
      }
    }
    recalculateWholesaleForRaffle(raffleId);
  });
  tx();

  return { ok: true, assigned: valid.length, skipped };
}

export function adminAssignPhoneToExactTicket(
  raffleId: number,
  rawPhone: string,
  ticketNumber: number,
): { ok: true } | { ok: false; error: string } {
  const raffle = getRaffleById(raffleId);
  if (!raffle) return { ok: false, error: "Акция не найдена" };
  const phone = normalizePhone(String(rawPhone || ""));
  if (!phone || !isValidRuMobile(phone)) {
    return { ok: false, error: "Некорректный мобильный номер РФ" };
  }
  const n = Math.floor(Number(ticketNumber));
  if (!Number.isFinite(n) || n < 1 || n > raffle.ticket_count) {
    return { ok: false, error: "Некорректный номерок" };
  }
  if (isRaffleTicketBlocked(raffleId, n)) {
    return { ok: false, error: "Номерок уже занят" };
  }
  const user = getUserByPhone(phone);
  if (user) {
    createOrAppendConfirmedTicketsForUser(raffleId, user.id, [n]);
  } else {
    db.prepare(
      `INSERT INTO raffle_phone_preassignments (raffle_id, ticket_number, phone, created_at) VALUES (?, ?, ?, ?)`,
    ).run(raffleId, n, phone, Date.now());
  }
  recalculateWholesaleForRaffle(raffleId);
  return { ok: true };
}

export function getAdminRaffleParticipantsBundle(raffleId: number): {
  wholesale_enabled: boolean;
  participants: AdminRaffleParticipantView[];
  wholesalers: AdminWholesalerRow[];
} {
  cleanupExpiredRaffleOrders();
  const raffle = getRaffleById(raffleId);
  const wholesale_enabled = Boolean(raffle && Number(raffle.wholesale_enabled));

  const countRows = db
    .prepare(
      `SELECT h.user_id AS user_id, COUNT(*) AS c
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND o.status = 'confirmed'
       GROUP BY h.user_id`,
    )
    .all(raffleId) as Array<{ user_id: number; c: number }>;
  const countMap = new Map(countRows.map((r) => [r.user_id, r.c]));

  const partRows = db
    .prepare(
      `SELECT h.ticket_number AS ticket_number, u.phone AS user_phone, o.status AS order_status, h.user_id AS user_id,
              u.name AS user_name, u.email AS user_email
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       INNER JOIN users u ON u.id = o.user_id
       WHERE h.raffle_id = ? AND o.status NOT IN ('expired', 'rejected')
       ORDER BY h.ticket_number ASC`,
    )
    .all(raffleId) as Array<{
    ticket_number: number;
    user_phone: string;
    order_status: string;
    user_id: number;
    user_name: string;
    user_email: string;
  }>;

  const fromOrders: AdminRaffleParticipantView[] = partRows.map((row) => ({
    ticket_number: row.ticket_number,
    user_phone: row.user_phone,
    order_status: row.order_status,
    is_wholesale:
      wholesale_enabled && (countMap.get(row.user_id) ?? 0) >= 10,
    user_id: row.user_id,
    user_name: row.user_name ?? "",
    user_email: row.user_email ?? "",
  }));

  const preRows = db
    .prepare(
      `SELECT ticket_number, phone FROM raffle_phone_preassignments WHERE raffle_id = ? ORDER BY ticket_number ASC`,
    )
    .all(raffleId) as Array<{ ticket_number: number; phone: string }>;

  const fromPre: AdminRaffleParticipantView[] = preRows.map((row) => ({
    ticket_number: row.ticket_number,
    user_phone: row.phone,
    order_status: "preassigned",
    is_wholesale: false,
    user_id: 0,
    user_name: "",
    user_email: "",
  }));

  const participants: AdminRaffleParticipantView[] = [...fromOrders, ...fromPre].sort(
    (a, b) => a.ticket_number - b.ticket_number,
  );

  let wholesalers: AdminWholesalerRow[] = [];
  if (wholesale_enabled) {
    wholesalers = db
      .prepare(
        `SELECT w.wholesale_number AS wholesale_number, u.phone AS user_phone
         FROM raffle_wholesale_assignments w
         INNER JOIN users u ON u.id = w.user_id
         WHERE w.raffle_id = ?
         ORDER BY w.wholesale_number ASC`,
      )
      .all(raffleId) as AdminWholesalerRow[];
  }

  return { wholesale_enabled, participants, wholesalers };
}

/** Номера оптовика пользователя по акциям (для экрана «Мои билеты»). */
export function listWholesaleSlotsForUser(userId: number): Array<{ raffle_id: number; wholesale_numbers: number[] }> {
  const rows = db
    .prepare(
      `SELECT raffle_id, wholesale_number FROM raffle_wholesale_assignments WHERE user_id = ? ORDER BY raffle_id ASC, wholesale_number ASC`,
    )
    .all(userId) as Array<{ raffle_id: number; wholesale_number: number }>;
  const map = new Map<number, number[]>();
  for (const r of rows) {
    const arr = map.get(r.raffle_id) ?? [];
    arr.push(r.wholesale_number);
    map.set(r.raffle_id, arr);
  }
  return [...map.entries()].map(([raffle_id, wholesale_numbers]) => ({ raffle_id, wholesale_numbers }));
}

export function addTicketsToReservedOrder(
  orderId: number,
  userId: number,
  newNumbers: number[],
): { ok: true } | { ok: false; error: string } {
  cleanupExpiredRaffleOrders();
  const o = getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Можно добавлять только к активной брони" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const raffle = getRaffleById(o.raffle_id);
  if (!raffle) return { ok: false, error: "Акция не найдена" };

  const existing = new Set(getTicketNumbersForOrder(orderId));
  const uniq = [...new Set(newNumbers.map((x) => Math.floor(Number(x))))].filter((n) =>
    Number.isFinite(n),
  );
  const toAdd: number[] = [];
  for (const n of uniq) {
    if (n < 1 || n > raffle.ticket_count) return { ok: false, error: "Некорректный номер" };
    if (existing.has(n)) continue;
    toAdd.push(n);
  }
  if (toAdd.length === 0) return { ok: false, error: "Укажите новые номера" };
  if (existing.size + toAdd.length > RAFFLE_MAX_SELECT) {
    return { ok: false, error: `Не больше ${RAFFLE_MAX_SELECT} номерков в брони` };
  }

  const now = Date.now();
  const reservedUntil = o.reserved_until;
  try {
    const tx = db.transaction(() => {
      for (const n of toAdd) {
        if (isRaffleTicketBlocked(o.raffle_id, n)) throw new Error("OCCUPIED");
      }
      const ins = db.prepare(
        `INSERT INTO raffle_ticket_holds (raffle_id, order_id, user_id, ticket_number, hold_status, expires_at, created_at)
         VALUES (?, ?, ?, ?, 'reserved', ?, ?)`,
      );
      for (const n of toAdd) {
        ins.run(o.raffle_id, orderId, userId, n, reservedUntil, now);
      }
      const allCount = existing.size + toAdd.length;
      const amount = allCount * raffle.price_rub;
      db.prepare(`UPDATE raffle_orders SET amount_rub = ?, ticket_count = ?, updated_at = ? WHERE id = ?`).run(
        amount,
        allCount,
        now,
        orderId,
      );
    });
    tx();
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.message === "OCCUPIED") {
      return { ok: false, error: "Один или несколько номерков уже заняты" };
    }
    throw e;
  }
}

export function appendRandomTicketsToReservedOrder(
  orderId: number,
  userId: number,
  want: number,
): { ok: true; picked: number[] } | { ok: false; error: string } {
  cleanupExpiredRaffleOrders();
  const o = getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Можно добавлять только к активной брони" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const raffle = getRaffleById(o.raffle_id);
  if (!raffle) return { ok: false, error: "Акция не найдена" };

  const existing = getTicketNumbersForOrder(orderId);
  const slots = RAFFLE_MAX_SELECT - existing.length;
  const nPick = Math.min(Math.max(1, Math.floor(want)), slots);
  if (nPick < 1) return { ok: false, error: "Достигнут лимит номерков" };

  const occupiedRows = db
    .prepare(
      `SELECT h.ticket_number FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o2 ON o2.id = h.order_id
       WHERE h.raffle_id = ? AND o2.status NOT IN ('expired', 'rejected')`,
    )
    .all(o.raffle_id) as { ticket_number: number }[];
  const preRows = db
    .prepare(`SELECT ticket_number FROM raffle_phone_preassignments WHERE raffle_id = ?`)
    .all(o.raffle_id) as { ticket_number: number }[];
  const occ = new Set([
    ...occupiedRows.map((r) => r.ticket_number),
    ...preRows.map((r) => r.ticket_number),
  ]);

  const free: number[] = [];
  for (let n = 1; n <= raffle.ticket_count; n++) {
    if (!occ.has(n)) free.push(n);
  }
  if (free.length === 0) return { ok: false, error: "Нет свободных номерков" };

  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = free[i];
    free[i] = free[j]!;
    free[j] = t!;
  }
  const picked = free.slice(0, Math.min(nPick, free.length));
  const add = addTicketsToReservedOrder(orderId, userId, picked);
  if (!add.ok) return add;
  return { ok: true, picked };
}

/** Сколько номерков уже занято по акции (бронь/проверка/подтверждено + предназначения по телефону). */
export function getRaffleOccupiedCount(raffleId: number): number {
  cleanupExpiredRaffleOrders();
  const holds = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND o.status NOT IN ('expired', 'rejected')`,
    )
    .get(raffleId) as { c: number } | undefined;
  const pre = db
    .prepare(`SELECT COUNT(*) AS c FROM raffle_phone_preassignments WHERE raffle_id = ?`)
    .get(raffleId) as { c: number } | undefined;
  return Math.max(0, Number((holds && holds.c) || 0) + Number((pre && pre.c) || 0));
}
