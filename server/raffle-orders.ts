import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import {
  getRaffleById,
  getRaffleEffectiveUnitPrice,
  isRaffleCenopadActive,
  getUserById,
  getUserByPhone,
  insertSupportMessage,
  isRaffleVisibleOnSite,
  getLatestVisibleActiveRaffle,
  listRafflesPublic,
  setRafflePromoGiftLockedCounts,
} from "./db.js";
import { isValidRuMobile, normalizePhone } from "./phone.js";
import { pgPool } from "./pg.js";
import { pgAll, pgExec, pgGet } from "./pg-sql.js";
import {
  getBankCardByIdForRaffle,
  isBankCardAvailableForNewPayment,
  isOrderEligibleForRaffleBankCardPayment,
  pickAvailableBankCard,
  refreshBankCardDailyLimitCooldown,
} from "./raffle-bank-cards.js";

export const RAFFLE_RESERVE_MS = 15 * 60 * 1000;
export const RAFFLE_MAX_SELECT = 25;

function resolveOrderUnitPrice(order: RaffleOrderRow, rafflePriceFallback: number): number {
  const cnt = Math.max(0, Math.floor(Number(order.ticket_count) || 0));
  const amount = Math.max(0, Math.floor(Number(order.amount_rub) || 0));
  if (cnt > 0 && amount > 0) {
    return Math.max(0, Math.floor(amount / cnt));
  }
  return Math.max(0, Math.floor(Number(rafflePriceFallback) || 0));
}

export type RaffleOrderRow = {
  id: number;
  raffle_id: number;
  user_id: number;
  bank: string | null;
  bank_card_id?: number | null;
  amount_rub: number;
  ticket_count: number;
  cenopad_applied?: number;
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

export async function insertRaffleOrderEvent(
  orderId: number,
  kind: string,
  detail: string | null,
  client?: PoolClient,
): Promise<void> {
  await pgExec(
    `INSERT INTO raffle_order_events (order_id, kind, detail, created_at) VALUES (?, ?, ?, ?)`,
    [orderId, kind, detail, Date.now()],
    client,
  );
}

export type RaffleOrderTimelineItem = { kind: string; label: string; at: number; detail: string | null };

const TIMELINE_LABELS: Record<string, string> = {
  reserved: "Бронь создана",
  receipt_submitted: "Чек отправлен на проверку",
  reject_rework: "Чек не принят — нужна новая загрузка",
  fully_released: "Заявка отменена, номерки свободны",
  confirmed: "Оплата закреплена",
  admin_ticket_removed: "Номерок снят администратором",
};

export async function listRaffleOrderTimeline(orderId: number): Promise<RaffleOrderTimelineItem[]> {
  const rows = await pgAll<{ kind: string; detail: string | null; created_at: number }>(
    `SELECT kind, detail, created_at FROM raffle_order_events WHERE order_id = ? ORDER BY created_at ASC`,
    [orderId],
  );
  return rows.map((r) => ({
    kind: r.kind,
    label: TIMELINE_LABELS[r.kind] ?? r.kind,
    at: r.created_at,
    /* JSON с url чека хранится в БД для истории оплат, на странице статуса не показываем */
    detail: r.kind === "receipt_submitted" ? null : (r.detail ?? null),
  }));
}

export type RaffleReceiptArchiveItemDto = {
  order_public_id: string;
  at_ms: number;
  url: string;
  name: string;
  mime: string | null;
};

export type RafflePaymentParticipationDto = {
  has_confirmed_tickets: boolean;
  confirmed_ticket_numbers: number[];
  receipt_submitted_event_count: number;
  current_order_reject_count: number;
  /** Показать предупреждение о повторной оплате / ранее отправленных чеках */
  show_repeat_payment_notice: boolean;
  prior_receipts: RaffleReceiptArchiveItemDto[];
};

type ReceiptArchiveRow = {
  order_id: number;
  order_public_id: string;
  at_ms: number;
  url: string;
  name: string;
  mime: string | null;
};

async function listReceiptArchiveForUserRaffle(userId: number, raffleId: number): Promise<ReceiptArchiveRow[]> {
  const items: ReceiptArchiveRow[] = [];
  const seen = new Set<string>();
  const eventRows = await pgAll<{ order_id: number; detail: string | null; created_at: number }>(
    `SELECT e.order_id AS order_id, e.detail AS detail, e.created_at AS created_at
       FROM raffle_order_events e
       INNER JOIN raffle_orders o ON o.id = e.order_id
       WHERE o.raffle_id = ? AND o.user_id = ? AND e.kind = 'receipt_submitted'
       ORDER BY e.created_at DESC`,
    [raffleId, userId],
  );

  for (const row of eventRows) {
    const d = String(row.detail ?? "").trim();
    if (!d.startsWith("{")) continue;
    try {
      const j = JSON.parse(d) as { url?: string; name?: string; mime?: string };
      const url = String(j.url ?? "").trim();
      if (!/^\/uploads\/receipts\/[a-zA-Z0-9._-]+$/.test(url)) continue;
      const key = `${row.order_id}:${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        order_id: row.order_id,
        order_public_id: `A${row.order_id}`,
        at_ms: row.created_at,
        url,
        name: String(j.name ?? "чек").slice(0, 255) || "чек",
        mime: j.mime ? String(j.mime) : null,
      });
    } catch {
      /* ignore malformed */
    }
  }

  const ordersWithReceipt = await pgAll<{
    id: number;
    receipt_url: string;
    receipt_name: string | null;
    receipt_mime: string | null;
    updated_at: number;
  }>(
    `SELECT id, receipt_url, receipt_name, receipt_mime, updated_at
       FROM raffle_orders
       WHERE raffle_id = ? AND user_id = ? AND receipt_url IS NOT NULL`,
    [raffleId, userId],
  );

  for (const o of ordersWithReceipt) {
    const url = String(o.receipt_url || "").trim();
    if (!/^\/uploads\/receipts\/[a-zA-Z0-9._-]+$/.test(url)) continue;
    const key = `${o.id}:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      order_id: o.id,
      order_public_id: `A${o.id}`,
      at_ms: o.updated_at,
      url,
      name: String(o.receipt_name || "чек").slice(0, 255) || "чек",
      mime: o.receipt_mime ? String(o.receipt_mime) : null,
    });
  }

  items.sort((a, b) => b.at_ms - a.at_ms);
  return items.slice(0, 40);
}

/** Чеки по той же акции и пользователю, кроме текущего файла на проверяемой заявке (для админки). */
export type AdminPriorReceiptItem = {
  order_id: number;
  order_public_id: string;
  at_ms: number;
  url: string;
  name: string;
  mime: string | null;
  /** Тот же заказ, но другой файл (например, после отклонения) */
  same_order: boolean;
};

export async function listReceiptHistoryPriorForPendingOrder(
  userId: number,
  raffleId: number,
  currentOrderId: number,
  currentReceiptUrl: string | null,
): Promise<AdminPriorReceiptItem[]> {
  const all = await listReceiptArchiveForUserRaffle(userId, raffleId);
  const curUrl = String(currentReceiptUrl ?? "").trim();
  return all
    .filter((x) => !(x.order_id === currentOrderId && curUrl && x.url === curUrl))
    .slice(0, 22)
    .map((x) => ({
      order_id: x.order_id,
      order_public_id: x.order_public_id,
      at_ms: x.at_ms,
      url: x.url,
      name: x.name,
      mime: x.mime,
      same_order: x.order_id === currentOrderId,
    }));
}

export async function buildRafflePaymentParticipationContext(
  userId: number,
  raffleId: number,
  currentOrderId: number | null,
): Promise<RafflePaymentParticipationDto> {
  const confirmedRows = await pgAll<{ ticket_number: number }>(
    `SELECT h.ticket_number AS ticket_number
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND o.user_id = ? AND o.status = 'confirmed'
       ORDER BY h.ticket_number ASC`,
    [raffleId, userId],
  );
  const confirmed_ticket_numbers = confirmedRows.map((r) => r.ticket_number);
  const has_confirmed_tickets = confirmed_ticket_numbers.length > 0;

  const evCountRow = await pgGet<{ c: number }>(
    `SELECT COUNT(*) AS c
       FROM raffle_order_events e
       INNER JOIN raffle_orders o ON o.id = e.order_id
       WHERE o.raffle_id = ? AND o.user_id = ? AND e.kind = 'receipt_submitted'`,
    [raffleId, userId],
  );
  const receipt_submitted_event_count = Math.floor(Number(evCountRow?.c ?? 0));

  let current_order_reject_count = 0;
  if (currentOrderId != null && Number.isFinite(currentOrderId) && currentOrderId > 0) {
    const o = await getOrderByIdForUser(currentOrderId, userId);
    if (o) current_order_reject_count = Math.floor(Number((o as RaffleOrderRow).receipt_reject_count ?? 0));
  }

  const prior = await listReceiptArchiveForUserRaffle(userId, raffleId);
  const prior_receipts: RaffleReceiptArchiveItemDto[] = prior.map((x) => ({
    order_public_id: x.order_public_id,
    at_ms: x.at_ms,
    url: x.url,
    name: x.name,
    mime: x.mime,
  }));

  const show_repeat_payment_notice =
    has_confirmed_tickets ||
    current_order_reject_count > 0 ||
    receipt_submitted_event_count > 1 ||
    prior_receipts.length > 1;

  return {
    has_confirmed_tickets,
    confirmed_ticket_numbers,
    receipt_submitted_event_count,
    current_order_reject_count,
    show_repeat_payment_notice,
    prior_receipts,
  };
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
export async function listReservedOrdersForExpiryReminder(
  now: number,
  leadMs: number,
): Promise<ReserveExpiryReminderRow[]> {
  if (leadMs <= 0) return [];
  await cleanupExpiredRaffleOrders();
  const until = now + leadMs;
  const rows = await pgAll<ReserveExpiryReminderRow>(
    `SELECT id AS order_id, user_id, raffle_id, reserved_until, amount_rub, ticket_count
       FROM raffle_orders
       WHERE status = 'reserved'
         AND reserved_until > ?
         AND reserved_until <= ?
         AND reserve_reminder_sent_at IS NULL`,
    [now, until],
  );
  return rows;
}

export async function markReserveReminderSent(orderId: number): Promise<void> {
  const now = Date.now();
  await pgExec(
    `UPDATE raffle_orders SET reserve_reminder_sent_at = ?, updated_at = ?
     WHERE id = ? AND status = 'reserved'`,
    [now, now, orderId],
  );
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

export async function cleanupExpiredRaffleOrders(client?: PoolClient): Promise<void> {
  const now = Date.now();
  await pgExec(
    `DELETE FROM raffle_ticket_holds WHERE order_id IN (
      SELECT id FROM raffle_orders WHERE status = 'reserved' AND reserved_until < ?
    )`,
    [now],
    client,
  );
  await pgExec(
    `UPDATE raffle_orders SET status = 'expired', updated_at = ? WHERE status = 'reserved' AND reserved_until < ?`,
    [now, now],
    client,
  );
}

async function getHoldForNumber(raffleId: number, ticketNumber: number, client?: PoolClient) {
  return await pgGet<{
    user_id: number;
    order_status: string;
    order_user_id: number;
    hold_status: string;
  }>(
    `SELECT h.*, o.status AS order_status, o.user_id AS order_user_id
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND h.ticket_number = ?`,
    [raffleId, ticketNumber],
    client,
  );
}

/** Занят ли номерок активной заявкой или предназначен заранее по телефону (ещё без аккаунта). */
export async function isRaffleTicketBlocked(
  raffleId: number,
  ticketNumber: number,
  client?: PoolClient,
): Promise<boolean> {
  const held = await pgGet<{ x?: number }>(
    `SELECT 1 AS x FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND h.ticket_number = ? AND o.status NOT IN ('expired', 'rejected')`,
    [raffleId, ticketNumber],
    client,
  );
  if (held) return true;
  const pre = await pgGet<{ x?: number }>(
    `SELECT 1 AS x FROM raffle_phone_preassignments WHERE raffle_id = ? AND ticket_number = ?`,
    [raffleId, ticketNumber],
    client,
  );
  return Boolean(pre);
}

/** Все номера 1..N, свободные для брони (без активного hold и без предназначения по телефону). */
export async function listGloballyFreeTicketNumbers(
  raffleId: number,
  client?: PoolClient,
): Promise<number[]> {
  if (client) await cleanupExpiredRaffleOrders(client);
  else await cleanupExpiredRaffleOrders();
  const raffle = await getRaffleById(raffleId);
  if (!raffle) return [];
  const maxN = Math.max(0, Math.floor(Number(raffle.ticket_count)));
  if (maxN < 1) return [];
  const occ = new Set<number>();
  const heldRows = await pgAll<{ n: number }>(
    `SELECT h.ticket_number AS n FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND o.status NOT IN ('expired', 'rejected')`,
    [raffleId],
    client,
  );
  for (const r of heldRows) occ.add(Math.floor(Number(r.n)));
  const preRows = await pgAll<{ n: number }>(
    `SELECT ticket_number AS n FROM raffle_phone_preassignments WHERE raffle_id = ?`,
    [raffleId],
    client,
  );
  for (const r of preRows) occ.add(Math.floor(Number(r.n)));
  const free: number[] = [];
  for (let n = 1; n <= maxN; n++) {
    if (!occ.has(n)) free.push(n);
  }
  return free;
}

async function getPreassignmentPhone(
  raffleId: number,
  ticketNumber: number,
  client?: PoolClient,
): Promise<string | null> {
  const row = await pgGet<{ phone: string }>(
    `SELECT phone FROM raffle_phone_preassignments WHERE raffle_id = ? AND ticket_number = ?`,
    [raffleId, ticketNumber],
    client,
  );
  return row ? row.phone : null;
}

/** Телефон владельца номерка в указанной акции (активный hold или предназначение до регистрации). */
export async function getPhoneForTicketInRaffle(
  raffleId: number,
  ticketNumber: number,
  client?: PoolClient,
): Promise<string | null> {
  const n = Math.floor(Number(ticketNumber));
  if (!Number.isFinite(n) || n < 1) return null;
  const row = await pgGet<{ phone: string }>(
    `SELECT u.phone AS phone
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       INNER JOIN users u ON u.id = o.user_id
       WHERE h.raffle_id = ? AND h.ticket_number = ? AND o.status NOT IN ('expired', 'rejected')
       ORDER BY CASE o.status
         WHEN 'confirmed' THEN 1
         WHEN 'pending_review' THEN 2
         WHEN 'reserved' THEN 3
         ELSE 4
       END,
       o.id DESC
       LIMIT 1`,
    [raffleId, n],
    client,
  );
  if (row?.phone) return String(row.phone);
  const pre = await getPreassignmentPhone(raffleId, n, client);
  return pre ? String(pre) : null;
}

export async function getTicketCellKind(
  raffleId: number,
  ticketNumber: number,
  currentUserId: number,
): Promise<TicketCellKind> {
  const row = await getHoldForNumber(raffleId, ticketNumber);
  if (!row) {
    const prePhone = await getPreassignmentPhone(raffleId, ticketNumber);
    if (prePhone) {
      const u = await getUserById(currentUserId);
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

export async function getTicketGridSlice(
  raffleId: number,
  userId: number,
  from: number,
  to: number,
): Promise<{ cells: { n: number; kind: TicketCellKind }[]; free_count: number }> {
  await cleanupExpiredRaffleOrders();
  const raffle = await getRaffleById(raffleId);
  if (!raffle) {
    return { cells: [], free_count: 0 };
  }
  const maxN = raffle.ticket_count;
  const a = Math.max(1, Math.floor(from));
  const b = Math.min(maxN, Math.floor(to));
  if (a > b) {
    return { cells: [], free_count: Math.max(0, maxN) };
  }

  const holdRows = await pgAll<{ ticket_number: number; order_status: string; order_user_id: number }>(
    `SELECT h.ticket_number AS ticket_number, o.status AS order_status, o.user_id AS order_user_id
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND h.ticket_number BETWEEN ? AND ?`,
    [raffleId, a, b],
  );

  const holdByNumber = new Map<number, { order_status: string; order_user_id: number }>();
  const holdScore = (status: string): number => {
    return status === "expired" || status === "rejected" ? 1 : 2;
  };
  for (const row of holdRows) {
    const n = Math.floor(Number(row.ticket_number));
    if (!Number.isFinite(n) || n < a || n > b) continue;
    const next = { order_status: String(row.order_status || ""), order_user_id: Math.floor(Number(row.order_user_id)) };
    const prev = holdByNumber.get(n);
    if (!prev || holdScore(next.order_status) > holdScore(prev.order_status)) {
      holdByNumber.set(n, next);
    }
  }

  const preRows = await pgAll<{ ticket_number: number; phone: string }>(
    `SELECT ticket_number AS ticket_number, phone AS phone
       FROM raffle_phone_preassignments
       WHERE raffle_id = ? AND ticket_number BETWEEN ? AND ?`,
    [raffleId, a, b],
  );
  const preByNumber = new Map<number, string>();
  for (const row of preRows) {
    const n = Math.floor(Number(row.ticket_number));
    if (!Number.isFinite(n) || n < a || n > b) continue;
    preByNumber.set(n, String(row.phone || ""));
  }

  const userPhone = String((await getUserById(userId))?.phone || "");
  const cells: { n: number; kind: TicketCellKind }[] = [];
  for (let n = a; n <= b; n++) {
    const hold = holdByNumber.get(n);
    if (hold) {
      const st = hold.order_status;
      if (st === "expired" || st === "rejected") {
        cells.push({ n, kind: "free" });
        continue;
      }
      if (hold.order_user_id !== userId) {
        cells.push({ n, kind: "taken" });
        continue;
      }
      if (st === "confirmed") {
        cells.push({ n, kind: "self_confirmed" });
        continue;
      }
      if (st === "pending_review") {
        cells.push({ n, kind: "self_pending" });
        continue;
      }
      if (st === "reserved") {
        cells.push({ n, kind: "self_reserved" });
        continue;
      }
      cells.push({ n, kind: "taken" });
      continue;
    }
    const prePhone = preByNumber.get(n);
    if (prePhone) {
      cells.push({ n, kind: userPhone && prePhone === userPhone ? "self_confirmed" : "taken" });
      continue;
    }
    cells.push({ n, kind: "free" });
  }
  const occupied = await pgGet<{ c: number }>(
    `SELECT COUNT(*) AS c FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND o.status NOT IN ('expired', 'rejected')`,
    [raffleId],
  );
  const preC = await pgGet<{ c: number }>(
    `SELECT COUNT(*) AS c FROM raffle_phone_preassignments WHERE raffle_id = ?`,
    [raffleId],
  );
  const free_count = Math.max(0, maxN - (occupied?.c ?? 0) - (preC?.c ?? 0));
  return { cells, free_count };
}

async function listNumbersWithExpiredReserveHold(
  raffleId: number,
  ticketNumbers: number[],
  nowMs: number,
): Promise<number[]> {
  const out: number[] = [];
  for (const n of ticketNumbers) {
    const hit = await pgGet<{ x?: number }>(
      `SELECT 1 AS x FROM raffle_ticket_holds h
     INNER JOIN raffle_orders o ON o.id = h.order_id
     WHERE h.raffle_id = ? AND h.ticket_number = ?
       AND o.status = 'reserved' AND o.reserved_until < ?`,
      [raffleId, n, nowMs],
    );
    if (hit) out.push(n);
  }
  return out;
}

export async function createReservation(
  raffleId: number,
  userId: number,
  numbers: number[],
): Promise<
  | {
      ok: true;
      order_id: number;
      reserved_until: number;
      skipped_still_occupied: number[];
      released_after_cleanup: number[];
    }
  | { ok: false; error: string }
> {
  const raffle = await getRaffleById(raffleId);
  if (!raffle || raffle.status !== "active") {
    return { ok: false, error: "Акция недоступна" };
  }
  if (!isRaffleVisibleOnSite(raffle)) {
    return { ok: false, error: "Акция недоступна" };
  }
  const existingOrder = await pgGet<{ id: number }>(
    `SELECT id FROM raffle_orders WHERE raffle_id = ? AND user_id = ? AND status IN ('reserved', 'pending_review')`,
    [raffleId, userId],
  );
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
  const hadExpiredReserveHold = await listNumbersWithExpiredReserveHold(raffleId, uniq, now);
  await cleanupExpiredRaffleOrders();

  const skipped_still_occupied: number[] = [];
  for (const n of uniq) {
    if (await isRaffleTicketBlocked(raffleId, n)) skipped_still_occupied.push(n);
  }
  const released_after_cleanup: number[] = [];
  for (const n of hadExpiredReserveHold) {
    if (!(await isRaffleTicketBlocked(raffleId, n))) released_after_cleanup.push(n);
  }
  const toReserve: number[] = [];
  for (const n of uniq) {
    if (!(await isRaffleTicketBlocked(raffleId, n))) toReserve.push(n);
  }

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
  const cenopadApplied = isRaffleCenopadActive(raffle) ? 1 : 0;
  const unitPrice = getRaffleEffectiveUnitPrice(raffle);
  const amount = toReserve.length * unitPrice;

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    for (const n of toReserve) {
      if (await isRaffleTicketBlocked(raffleId, n, client)) throw new Error("OCCUPIED");
    }
    const pubTok = newPublicOrderToken();
    const insRow = await pgGet<{ id: number }>(
      `INSERT INTO raffle_orders (
            raffle_id, user_id, bank, amount_rub, ticket_count, cenopad_applied, status,
            reserved_until, receipt_url, receipt_name, receipt_mime, public_status_token, created_at, updated_at
          ) VALUES (?, ?, NULL, ?, ?, ?, 'reserved', ?, NULL, NULL, NULL, ?, ?, ?) RETURNING id`,
      [raffleId, userId, amount, toReserve.length, cenopadApplied, reservedUntil, pubTok, now, now],
      client,
    );
    const orderId = Number(insRow?.id);
    if (!Number.isFinite(orderId) || orderId <= 0) throw new Error("INSERT_FAILED");
    await insertRaffleOrderEvent(orderId, "reserved", null, client);
    for (const n of toReserve) {
      await pgExec(
        `INSERT INTO raffle_ticket_holds (raffle_id, order_id, user_id, ticket_number, hold_status, expires_at, created_at)
         VALUES (?, ?, ?, ?, 'reserved', ?, ?)`,
        [raffleId, orderId, userId, n, reservedUntil, now],
        client,
      );
    }
    await client.query("COMMIT");
    return {
      ok: true,
      order_id: orderId,
      reserved_until: reservedUntil,
      skipped_still_occupied,
      released_after_cleanup,
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    if (e instanceof Error && e.message === "OCCUPIED") {
      return { ok: false, error: "Один или несколько номерков уже заняты — обновите страницу и попробуйте снова." };
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function getActiveOrderForUser(
  raffleId: number,
  userId: number,
): Promise<RaffleOrderRow | undefined> {
  await cleanupExpiredRaffleOrders();
  return await pgGet<RaffleOrderRow>(
    `SELECT * FROM raffle_orders WHERE raffle_id = ? AND user_id = ? AND status IN ('reserved', 'pending_review') ORDER BY id DESC LIMIT 1`,
    [raffleId, userId],
  );
}

export async function getOrderByIdForUser(
  orderId: number,
  userId: number,
  client?: PoolClient,
): Promise<RaffleOrderRow | undefined> {
  if (!client) await cleanupExpiredRaffleOrders();
  return await pgGet<RaffleOrderRow>(`SELECT * FROM raffle_orders WHERE id = ? AND user_id = ?`, [orderId, userId], client);
}

export async function getOrderById(orderId: number, client?: PoolClient): Promise<RaffleOrderRow | undefined> {
  return await pgGet<RaffleOrderRow>(`SELECT * FROM raffle_orders WHERE id = ?`, [orderId], client);
}

export async function getOrderPaymentBankCardSuggestion(
  orderId: number,
  userId: number,
): Promise<
  | { ok: false; error: string }
  | { ok: true; card: { id: number; card_number: string; recipient: string } | null }
> {
  await cleanupExpiredRaffleOrders();
  const o = await getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Недоступно для этой заявки" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const raffle = await getRaffleById(o.raffle_id);
  if (!raffle) return { ok: false, error: "Акция не найдена" };
  const card = await pickAvailableBankCard({
    raffleId: o.raffle_id,
    nowMs: Date.now(),
    orderTicketCount: o.ticket_count,
    cardPaymentScope: String((raffle as { card_payment_scope?: string }).card_payment_scope ?? "unlimited"),
    wholesaleEveryN: Math.max(
      1,
      Math.floor(Number((raffle as { wholesale_every_n_tickets?: number }).wholesale_every_n_tickets) || 10),
    ),
    cardPaymentMinTickets: Math.max(
      1,
      Math.floor(Number((raffle as { card_payment_min_tickets?: number }).card_payment_min_tickets) || 2),
    ),
  });
  return {
    ok: true,
    card: card ? { id: card.id, card_number: card.card_number, recipient: card.recipient } : null,
  };
}

export async function setOrderBank(
  orderId: number,
  userId: number,
  bank: "sber" | "other",
  bankCardId: number | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await cleanupExpiredRaffleOrders();
  const o = await getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Статус не позволяет изменить банк" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const raffle = await getRaffleById(o.raffle_id);
  if (!raffle) return { ok: false, error: "Акция не найдена" };
  const now = Date.now();
  let nextCardId: number | null =
    bankCardId != null && Number.isFinite(Number(bankCardId)) ? Math.floor(Number(bankCardId)) : null;
  if (bank === "sber") {
    nextCardId = null;
  } else if (nextCardId != null && nextCardId > 0) {
    const card = await getBankCardByIdForRaffle(nextCardId, o.raffle_id);
    if (!card) return { ok: false, error: "Карта не найдена" };
    const scope = String((raffle as { card_payment_scope?: string }).card_payment_scope ?? "unlimited")
      .trim()
      .toLowerCase();
    const everyN = Math.max(
      1,
      Math.floor(Number((raffle as { wholesale_every_n_tickets?: number }).wholesale_every_n_tickets) || 10),
    );
    const minOrderT = Math.max(
      1,
      Math.floor(Number((raffle as { card_payment_min_tickets?: number }).card_payment_min_tickets) || 2),
    );
    const tickets = Math.max(0, Math.floor(Number(o.ticket_count) || 0));
    if (
      !isOrderEligibleForRaffleBankCardPayment({
        cardPaymentScope: scope,
        orderTicketCount: tickets,
        wholesaleEveryN: everyN,
        cardPaymentMinTickets: minOrderT,
      })
    ) {
      if (scope === "wholesale_only") {
        return {
          ok: false,
          error: `Оплата на карту доступна только при заказе от ${everyN} номерков`,
        };
      }
      if (scope === "min_order_tickets") {
        return {
          ok: false,
          error: `Оплата на карту доступна только при заказе от ${minOrderT} номерков`,
        };
      }
    }
    const av = await isBankCardAvailableForNewPayment(card, now);
    if (!av.ok) return { ok: false, error: "Эта карта сейчас недоступна — выберите другой способ оплаты" };
  } else {
    nextCardId = null;
  }
  await pgExec(`UPDATE raffle_orders SET bank = ?, bank_card_id = ?, updated_at = ? WHERE id = ?`, [
    bank,
    nextCardId,
    now,
    orderId,
  ]);
  return { ok: true };
}

export async function attachReceiptToOrder(
  orderId: number,
  userId: number,
  receipt: { url: string; name: string; mime: string; sha256?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await cleanupExpiredRaffleOrders();
  if (!/^\/uploads\/receipts\/[a-zA-Z0-9._-]+$/.test(receipt.url)) {
    return { ok: false, error: "Некорректная ссылка на чек" };
  }
  const sha = String(receipt.sha256 || "")
    .trim()
    .toLowerCase();
  if (sha && !/^[a-f0-9]{64}$/.test(sha)) {
    return { ok: false, error: "Некорректный отпечаток файла" };
  }
  const o = await getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status === "pending_review") {
    // Идемпотентность: если первый запрос уже успел перевести заказ в pending_review,
    // повтор (например, после сетевого сбоя у клиента) считаем успешным.
    return { ok: true };
  }
  if (o.status !== "reserved") return { ok: false, error: "Чек можно прикрепить только к активной брони" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const now = Date.now();

  const isSameAsPrevious = 0;
  await pgExec(
    `UPDATE raffle_orders
     SET receipt_url = ?, receipt_name = ?, receipt_mime = ?, receipt_sha256 = ?, receipt_same_as_previous = ?,
         status = 'pending_review', updated_at = ?
     WHERE id = ?`,
    [receipt.url, receipt.name, receipt.mime, sha || null, isSameAsPrevious, now, orderId],
  );
  await pgExec(`UPDATE raffle_ticket_holds SET hold_status = 'payment_pending', expires_at = NULL WHERE order_id = ?`, [
    orderId,
  ]);
  const receiptEventDetail = JSON.stringify({
    url: receipt.url,
    name: receipt.name,
    mime: receipt.mime,
  });
  await insertRaffleOrderEvent(orderId, "receipt_submitted", receiptEventDetail);
  await refreshBankCardDailyLimitCooldown((o as RaffleOrderRow).bank_card_id ?? null, now);
  return { ok: true };
}

export type PendingPaymentRow = RaffleOrderRow & { raffle_title: string; user_phone: string; user_name: string };

export async function listPendingPayments(): Promise<PendingPaymentRow[]> {
  return await pgAll<PendingPaymentRow>(
    `SELECT o.*, r.title AS raffle_title, u.phone AS user_phone, u.name AS user_name
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       INNER JOIN users u ON u.id = o.user_id
       WHERE o.status = 'pending_review'
       ORDER BY o.created_at ASC`,
    [],
  );
}

export async function confirmOrderByAdmin(orderId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const o = await getOrderById(orderId);
  if (!o) return { ok: false, error: "Не найдено" };
  if (o.status !== "pending_review") return { ok: false, error: "Неверный статус" };
  const raffle = await getRaffleById(o.raffle_id);
  if (!raffle) return { ok: false, error: "Акция не найдена" };
  const now = Date.now();
  const raffleId = o.raffle_id;
  const paidCount = Math.max(0, Math.floor(Number(o.ticket_count) || 0));
  const bonusPerFive =
    Number(raffle.promo_5_plus_2_enabled) === 1
      ? 2
      : Number(raffle.promo_5_plus_1_enabled) === 1
        ? 1
        : 0;
  const giftWant =
    bonusPerFive > 0 && paidCount >= 5 ? Math.floor(paidCount / 5) * bonusPerFive : 0;
  const bonusPromoKind = bonusPerFive === 2 ? "5plus2" : bonusPerFive === 1 ? "5plus1" : null;
  const giftedNumbers: number[] = [];
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await pgExec(
      `UPDATE raffle_orders SET status = 'confirmed', receipt_reject_count = 0, last_reject_comment = NULL, updated_at = ? WHERE id = ?`,
      [now, orderId],
      client,
    );
    await pgExec(`UPDATE raffle_ticket_holds SET hold_status = 'confirmed' WHERE order_id = ?`, [orderId], client);
    if (giftWant > 0) {
      const free = await listGloballyFreeTicketNumbers(raffleId, client);
      for (let i = free.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = free[i]!;
        free[i] = free[j]!;
        free[j] = t;
      }
      const picked = free.slice(0, Math.min(giftWant, free.length));
      if (picked.length > 0) {
        for (const n of picked) {
          await pgExec(
            `INSERT INTO raffle_ticket_holds (raffle_id, order_id, user_id, ticket_number, is_bonus, bonus_promo_kind, hold_status, expires_at, created_at)
           VALUES (?, ?, ?, ?, 1, ?, 'confirmed', NULL, ?)`,
            [raffleId, orderId, o.user_id, n, bonusPromoKind, now],
            client,
          );
          giftedNumbers.push(n);
        }
      }
    }
    const eventDetail = giftedNumbers.length
      ? JSON.stringify({
          promo: bonusPerFive === 2 ? "5+2" : "5+1",
          gift_count: giftedNumbers.length,
          gift_numbers: giftedNumbers,
        })
      : null;
    await insertRaffleOrderEvent(orderId, "confirmed", eventDetail, client);
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
  await recalculateRaffleDerivedStatsForRaffle(raffleId);
  return { ok: true };
}

/** Полностью снять бронь / отменить заявку: номерки освобождаются. */
export async function adminFullyReleaseRaffleOrder(
  orderId: number,
  eventDetail: string | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const o = await getOrderById(orderId);
  if (!o) return { ok: false, error: "Не найдено" };
  if (o.status !== "reserved" && o.status !== "pending_review") {
    return { ok: false, error: "Можно снять только активную бронь или заявку на проверке" };
  }
  const now = Date.now();
  const raffleId = o.raffle_id;
  await pgExec(`DELETE FROM raffle_ticket_holds WHERE order_id = ?`, [orderId]);
  await pgExec(
    `UPDATE raffle_orders SET status = 'rejected', receipt_url = NULL, receipt_name = NULL, receipt_mime = NULL, updated_at = ? WHERE id = ?`,
    [now, orderId],
  );
  await insertRaffleOrderEvent(orderId, "fully_released", eventDetail);
  await recalculateRaffleDerivedStatsForRaffle(raffleId);
  return { ok: true };
}

/** Отмена активной брони самим пользователем (только до отправки чека). */
export async function userCancelReservedRaffleOrder(
  orderId: number,
  userId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const o = await getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Не найдено" };
  if (o.status !== "reserved") {
    return { ok: false, error: "Отменить можно только активную бронь до отправки чека" };
  }
  return await adminFullyReleaseRaffleOrder(orderId, "Отменено пользователем");
}

export async function rejectOrderByAdmin(
  orderId: number,
  opts?: { adminNote?: string },
): Promise<{ ok: true; mode: "rework" | "fully_released" } | { ok: false; error: string }> {
  const o = await getOrderById(orderId);
  if (!o) return { ok: false, error: "Не найдено" };
  if (o.status !== "pending_review") return { ok: false, error: "Неверный статус" };
  const note = String(opts?.adminNote ?? "").trim().slice(0, 500);
  const count = Number((o as RaffleOrderRow).receipt_reject_count ?? 0);
  const max = raffleMaxRejectReworksFromEnv();
  if (count >= max) {
    const detail = note || `Достигнут лимит доработок чека (${max})`;
    const r = await adminFullyReleaseRaffleOrder(orderId, detail);
    if (!r.ok) return { ok: false, error: "error" in r ? r.error : "Неизвестная ошибка" };
    if (note) {
      await pgExec(`UPDATE raffle_orders SET last_reject_comment = ?, updated_at = ? WHERE id = ?`, [
        note,
        Date.now(),
        orderId,
      ]);
    }
    return { ok: true, mode: "fully_released" };
  }
  const now = Date.now();
  const raffleId = o.raffle_id;
  const newUntil = now + rejectReopenReserveMsFromEnv();
  await pgExec(
    `UPDATE raffle_orders SET status = 'reserved', receipt_url = NULL, receipt_name = NULL, receipt_mime = NULL,
     reserved_until = ?, reserve_extended_once = 0, reserve_reminder_sent_at = NULL,
     receipt_reject_count = COALESCE(receipt_reject_count, 0) + 1, last_reject_comment = ?, updated_at = ? WHERE id = ?`,
    [newUntil, note || null, now, orderId],
  );
  await pgExec(`UPDATE raffle_ticket_holds SET hold_status = 'reserved', expires_at = ? WHERE order_id = ?`, [
    newUntil,
    orderId,
  ]);
  await insertRaffleOrderEvent(orderId, "reject_rework", note || null);
  await recalculateRaffleDerivedStatsForRaffle(raffleId);
  return { ok: true, mode: "rework" };
}

export type AdminActiveOrderRow = RaffleOrderRow & {
  raffle_title: string;
  user_phone: string;
  user_name: string;
  user_id: number;
};

export async function listActiveOrdersForAdmin(): Promise<AdminActiveOrderRow[]> {
  await cleanupExpiredRaffleOrders();
  const now = Date.now();
  return await pgAll<AdminActiveOrderRow>(
    `SELECT o.*, r.title AS raffle_title, u.phone AS user_phone, u.name AS user_name
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       INNER JOIN users u ON u.id = o.user_id
       WHERE o.status = 'reserved' AND o.reserved_until > ?
       ORDER BY o.reserved_until ASC
       LIMIT 300`,
    [now],
  );
}

export type AdminOrderReceiptHistoryItem = {
  at_ms: number;
  url: string;
  name: string;
  mime: string | null;
};

export type AdminPaymentHistoryRow = RaffleOrderRow & {
  raffle_title: string;
  user_phone: string;
  user_name: string;
  user_id: number;
  ticket_numbers: number[];
  receipt_history: AdminOrderReceiptHistoryItem[];
};

async function listReceiptHistoryForOrder(
  orderId: number,
  fallback?: { url?: string | null; name?: string | null; mime?: string | null },
): Promise<AdminOrderReceiptHistoryItem[]> {
  const rows = await pgAll<{ detail: string | null; created_at: number }>(
    `SELECT detail, created_at
       FROM raffle_order_events
       WHERE order_id = ? AND kind = 'receipt_submitted'
       ORDER BY created_at DESC`,
    [orderId],
  );
  const items: AdminOrderReceiptHistoryItem[] = [];
  for (const row of rows) {
    const raw = String(row.detail ?? "").trim();
    if (!raw.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(raw) as { url?: string; name?: string; mime?: string };
      const url = String(parsed.url ?? "").trim();
      if (!url) continue;
      items.push({
        at_ms: Number(row.created_at) || 0,
        url,
        name: String(parsed.name ?? "чек").slice(0, 255) || "чек",
        mime: parsed.mime ? String(parsed.mime) : null,
      });
    } catch {
      /* ignore malformed history row */
    }
  }
  const fallbackUrl = String(fallback?.url ?? "").trim();
  if (fallbackUrl && !items.some((x) => x.url === fallbackUrl)) {
    items.push({
      at_ms: Date.now(),
      url: fallbackUrl,
      name: String(fallback?.name ?? "чек").slice(0, 255) || "чек",
      mime: fallback?.mime ? String(fallback.mime) : null,
    });
  }
  return items.slice(0, 40);
}

export async function listPaymentHistoryForAdmin(limit = 300, offset = 0): Promise<AdminPaymentHistoryRow[]> {
  const lim = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 300)));
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const rows = await pgAll<RaffleOrderRow & { raffle_title: string; user_phone: string; user_name: string; user_id: number }>(
    `SELECT o.*, r.title AS raffle_title, u.phone AS user_phone, u.name AS user_name, u.id AS user_id
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       INNER JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
    [lim, off],
  );
  return await Promise.all(
    rows.map(async (row) => ({
      ...row,
      user_id: Number(row.user_id) || 0,
      ticket_numbers: await getTicketNumbersForOrder(row.id),
      receipt_history: await listReceiptHistoryForOrder(row.id, {
        url: row.receipt_url,
        name: row.receipt_name,
        mime: row.receipt_mime,
      }),
    })),
  );
}

export async function countPaymentHistoryForAdmin(): Promise<number> {
  const row = await pgGet<{ c: number }>(`SELECT COUNT(*) AS c FROM raffle_orders`, []);
  return Math.max(0, Number(row?.c ?? 0));
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

export async function getPublicOrderStatusByToken(rawToken: string): Promise<PublicOrderStatusDto | null> {
  const t = String(rawToken ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(t)) return null;
  const o = await pgGet<RaffleOrderRow>(`SELECT * FROM raffle_orders WHERE public_status_token = ?`, [t]);
  if (!o) return null;
  const raffle = await getRaffleById(o.raffle_id);
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
    timeline: await listRaffleOrderTimeline(o.id),
    review_eta_hint: receiptReviewEtaHintFromEnv(),
  };
}

export function orderToDto(o: RaffleOrderRow) {
  const tok = String((o as RaffleOrderRow).public_status_token ?? "").trim();
  const bc = (o as RaffleOrderRow).bank_card_id;
  const bank_card_id = bc != null && Number.isFinite(Number(bc)) ? Math.floor(Number(bc)) : null;
  return {
    id: o.id,
    raffle_id: o.raffle_id,
    bank: o.bank,
    bank_card_id,
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
export async function extendReservedOrderOnce(
  orderId: number,
  userId: number,
): Promise<{ ok: true; order: ReturnType<typeof orderToDto> } | { ok: false; error: string }> {
  await cleanupExpiredRaffleOrders();
  const o = await getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Нельзя продлить эту заявку" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  if (Number((o as { reserve_extended_once?: number }).reserve_extended_once))
    return { ok: false, error: "Продление уже использовано" };
  const now = Date.now();
  const newUntil = o.reserved_until + RESERVE_EXTEND_MS;
  await pgExec(
    `UPDATE raffle_orders SET reserved_until = ?, reserve_extended_once = 1, reserve_reminder_sent_at = NULL, updated_at = ? WHERE id = ?`,
    [newUntil, now, orderId],
  );
  await pgExec(`UPDATE raffle_ticket_holds SET expires_at = ? WHERE order_id = ?`, [newUntil, orderId]);
  const updated = await getOrderByIdForUser(orderId, userId);
  if (!updated) return { ok: false, error: "Ошибка" };
  return { ok: true, order: orderToDto(updated) };
}

export async function getTicketNumbersForOrder(orderId: number, client?: PoolClient): Promise<number[]> {
  const rows = await pgAll<{ ticket_number: number }>(
    `SELECT ticket_number FROM raffle_ticket_holds WHERE order_id = ? ORDER BY ticket_number ASC`,
    [orderId],
    client,
  );
  return rows.map((r) => r.ticket_number);
}

async function getPaidTicketNumbersForOrder(orderId: number, client?: PoolClient): Promise<number[]> {
  const rows = await pgAll<{ ticket_number: number }>(
    `SELECT ticket_number FROM raffle_ticket_holds
       WHERE order_id = ? AND COALESCE(is_bonus, 0) = 0
       ORDER BY ticket_number ASC`,
    [orderId],
    client,
  );
  return rows.map((r) => r.ticket_number);
}

/** Пользователи с хотя бы одной подтверждённой оплатой по акции (для рассылок в чат). */
export async function listUserIdsWithConfirmedRaffleOrders(): Promise<number[]> {
  const rows = await pgAll<{ uid: number }>(
    `SELECT DISTINCT o.user_id AS uid
       FROM raffle_orders o
       INNER JOIN users u ON u.id = o.user_id
       WHERE o.status = 'confirmed' AND COALESCE(u.blocked, 0) = 0
       ORDER BY uid ASC`,
    [],
  );
  return rows.map((r) => Number(r.uid)).filter((id) => Number.isFinite(id) && id > 0);
}

export async function listReservedOrdersForUser(userId: number): Promise<
  Array<{
    order: ReturnType<typeof orderToDto>;
    numbers: number[];
    timeline: RaffleOrderTimelineItem[];
    raffle: { id: number; title: string; price_rub: number };
  }>
> {
  await cleanupExpiredRaffleOrders();
  const now = Date.now();
  const rows = await pgAll<RaffleOrderRow & { raffle_title: string; raffle_price: number }>(
    `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.status = 'reserved' AND o.reserved_until > ?
         AND COALESCE(r.hidden_from_public, 0) = 0
       ORDER BY o.id DESC`,
    [userId, now],
  );
  return await Promise.all(
    rows.map(async (row) => ({
      order: orderToDto(row),
      numbers: await getTicketNumbersForOrder(row.id),
      timeline: await listRaffleOrderTimeline(row.id),
      raffle: {
        id: row.raffle_id,
        title: row.raffle_title,
        price_rub: row.raffle_price,
      },
    })),
  );
}

/** Лёгкий вариант reserved-групп без timeline (для корзины и частых polling API). */
export async function listReservedOrdersForUserLite(userId: number): Promise<
  Array<{
    order: ReturnType<typeof orderToDto>;
    numbers: number[];
    timeline: RaffleOrderTimelineItem[];
    raffle: { id: number; title: string; price_rub: number };
  }>
> {
  await cleanupExpiredRaffleOrders();
  const now = Date.now();
  const rows = await pgAll<RaffleOrderRow & { raffle_title: string; raffle_price: number }>(
    `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.status = 'reserved' AND o.reserved_until > ?
         AND COALESCE(r.hidden_from_public, 0) = 0
       ORDER BY o.id DESC`,
    [userId, now],
  );
  const orderIds = rows
    .map((row) => Math.floor(Number(row.id)))
    .filter((id) => Number.isFinite(id) && id > 0);
  const numbersByOrderId = new Map<number, number[]>();
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => "?").join(", ");
    const numRows = await pgAll<{ order_id: number; ticket_number: number }>(
      `SELECT order_id AS order_id, ticket_number AS ticket_number
         FROM raffle_ticket_holds
         WHERE order_id IN (${placeholders})
         ORDER BY order_id ASC, ticket_number ASC`,
      orderIds,
    );
    for (const row of numRows) {
      const oid = Math.floor(Number(row.order_id));
      if (!numbersByOrderId.has(oid)) numbersByOrderId.set(oid, []);
      numbersByOrderId.get(oid)!.push(Math.floor(Number(row.ticket_number)));
    }
  }
  return rows.map((row) => ({
    order: orderToDto(row),
    numbers: numbersByOrderId.get(Math.floor(Number(row.id))) ?? [],
    timeline: [],
    raffle: {
      id: row.raffle_id,
      title: row.raffle_title,
      price_rub: row.raffle_price,
    },
  }));
}

/** Снять все видимые пользователю активные брони (очистка корзины) за один заход к БД по списку заявок. */
export async function clearAllUserReservedCartItems(
  userId: number,
): Promise<{ ok: true; raffle_ids: number[] } | { ok: false; error: string }> {
  await cleanupExpiredRaffleOrders();
  const now = Date.now();
  const rows = await pgAll<{ id: number; raffle_id: number }>(
    `SELECT o.id, o.raffle_id FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.status = 'reserved' AND o.reserved_until > ?
         AND COALESCE(r.hidden_from_public, 0) = 0`,
    [userId, now],
  );
  const raffleIds = new Set<number>();
  for (const row of rows) {
    const res = await userCancelReservedRaffleOrder(row.id, userId);
    if (!res.ok) return { ok: false, error: "error" in res ? res.error : "Неизвестная ошибка" };
    const rid = Number(row.raffle_id);
    if (Number.isFinite(rid) && rid > 0) raffleIds.add(rid);
  }
  return { ok: true, raffle_ids: [...raffleIds] };
}

export async function removeTicketFromReservedOrder(
  orderId: number,
  userId: number,
  ticketNumber: number,
): Promise<
  { ok: true; order: ReturnType<typeof orderToDto> | null; numbers: number[] } | { ok: false; error: string }
> {
  await cleanupExpiredRaffleOrders();
  const o = await getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Нельзя изменить заявку" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const raffle = await getRaffleById(o.raffle_id);
  if (!raffle) return { ok: false, error: "Акция не найдена" };

  const del = await pgExec(`DELETE FROM raffle_ticket_holds WHERE order_id = ? AND ticket_number = ?`, [
    orderId,
    ticketNumber,
  ]);
  if (del === 0) return { ok: false, error: "Номерок не в заявке" };

  const nums = await getTicketNumbersForOrder(orderId);
  const now = Date.now();
  if (nums.length === 0) {
    await pgExec(`DELETE FROM raffle_orders WHERE id = ?`, [orderId]);
    return { ok: true, order: null, numbers: [] };
  }
  const unitPrice = resolveOrderUnitPrice(o, getRaffleEffectiveUnitPrice(raffle));
  const amount = nums.length * unitPrice;
  await pgExec(`UPDATE raffle_orders SET amount_rub = ?, ticket_count = ?, updated_at = ? WHERE id = ?`, [
    amount,
    nums.length,
    now,
    orderId,
  ]);
  const updated = await getOrderByIdForUser(orderId, userId);
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
export async function adminDetachParticipantTicket(
  raffleId: number,
  ticketNumber: number,
): Promise<{ ok: true; affected_user_id: number | null } | { ok: false; error: string }> {
  await cleanupExpiredRaffleOrders();
  const raffle = await getRaffleById(raffleId);
  if (!raffle) return { ok: false, error: "Акция не найдена" };
  const n = Math.floor(Number(ticketNumber));
  if (!Number.isFinite(n) || n < 1 || n > raffle.ticket_count) {
    return { ok: false, error: "Некорректный номерок" };
  }

  const pre = await pgExec(`DELETE FROM raffle_phone_preassignments WHERE raffle_id = ? AND ticket_number = ?`, [
    raffleId,
    n,
  ]);
  if (pre > 0) {
    return { ok: true, affected_user_id: null };
  }

  const row = await pgGet<{ order_id: number; user_id: number }>(
    `SELECT h.order_id AS order_id, o.user_id AS user_id
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND h.ticket_number = ? AND o.status NOT IN ('expired', 'rejected')`,
    [raffleId, n],
  );

  if (!row) return { ok: false, error: "Номерок не занят или уже снят" };

  const orderId = row.order_id;
  const affectedUserId = row.user_id;
  const now = Date.now();

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const del = await pgExec(`DELETE FROM raffle_ticket_holds WHERE order_id = ? AND ticket_number = ?`, [orderId, n], client);
    if (del === 0) throw new Error("HOLD_MISSING");

    const nums = await getTicketNumbersForOrder(orderId, client);
    if (nums.length === 0) {
      await pgExec(`DELETE FROM raffle_orders WHERE id = ?`, [orderId], client);
    } else {
      const paidNums = await getPaidTicketNumbersForOrder(orderId, client);
      const paidCount = paidNums.length;
      const ord = await getOrderById(orderId, client);
      const unitPrice = resolveOrderUnitPrice(ord as RaffleOrderRow, getRaffleEffectiveUnitPrice(raffle));
      const amount = paidCount * unitPrice;
      await pgExec(`UPDATE raffle_orders SET amount_rub = ?, ticket_count = ?, updated_at = ? WHERE id = ?`, [
        amount,
        paidCount,
        now,
        orderId,
      ], client);
      await insertRaffleOrderEvent(orderId, "admin_ticket_removed", "№ " + String(n), client);
    }
    await client.query("COMMIT");
  } catch {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    return { ok: false, error: "Не удалось снять номерок" };
  } finally {
    client.release();
  }

  await recalculateRaffleDerivedStatsForRaffle(raffleId);
  return { ok: true, affected_user_id: affectedUserId };
}

export async function listConfirmedTicketGroupsForUser(userId: number): Promise<
  Array<{
    order: ReturnType<typeof orderToDto>;
    numbers: number[];
    timeline: RaffleOrderTimelineItem[];
    raffle: { id: number; title: string; price_rub: number; status: string };
  }>
> {
  const rows = await pgAll<RaffleOrderRow & { raffle_title: string; raffle_price: number; raffle_status: string }>(
    `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price, r.status AS raffle_status
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.status = 'confirmed'
         AND COALESCE(r.hidden_from_public, 0) = 0
       ORDER BY o.id DESC`,
    [userId],
  );
  return await Promise.all(
    rows.map(async (row) => ({
      order: orderToDto(row),
      numbers: await getTicketNumbersForOrder(row.id),
      timeline: await listRaffleOrderTimeline(row.id),
      raffle: {
        id: row.raffle_id,
        title: row.raffle_title,
        price_rub: row.raffle_price,
        status: String(row.raffle_status || "active"),
      },
    })),
  );
}

export type ParticipationHistoryRaffle = {
  raffle: { id: number; title: string; status: string };
  last_activity_at: number;
  numbers: {
    reserved: number[];
    pending_review: number[];
    confirmed: number[];
    bonus_confirmed: number[];
    bonus_5plus1_confirmed: number[];
    bonus_5plus2_confirmed: number[];
  };
};

/** История участий пользователя по всем акциям: какие номерки закреплялись в каждом статусе. */
export async function listParticipationHistoryForUser(userId: number): Promise<ParticipationHistoryRaffle[]> {
  type Row = {
    raffle_id: number;
    raffle_title: string;
    raffle_status: string;
    order_status: string;
    ord_updated_at: number;
    ticket_number: number;
    is_bonus: number;
    bonus_promo_kind: string | null;
  };
  const rows = await pgAll<Row>(
    `SELECT
         r.id AS raffle_id,
         r.title AS raffle_title,
         r.status AS raffle_status,
         o.status AS order_status,
         o.updated_at AS ord_updated_at,
         h.ticket_number AS ticket_number,
         COALESCE(h.is_bonus, 0) AS is_bonus,
         h.bonus_promo_kind AS bonus_promo_kind
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       INNER JOIN raffle_ticket_holds h ON h.order_id = o.id
       WHERE o.user_id = ? AND o.status IN ('reserved', 'pending_review', 'confirmed')
       ORDER BY o.updated_at DESC, o.id DESC, h.ticket_number ASC`,
    [userId],
  );

  const map = new Map<number, ParticipationHistoryRaffle>();
  for (const row of rows) {
    const rid = Number(row.raffle_id);
    if (!Number.isFinite(rid) || rid < 1) continue;
    let entry = map.get(rid);
    if (!entry) {
      entry = {
        raffle: {
          id: rid,
          title: String(row.raffle_title || ""),
          status: String(row.raffle_status || "active"),
        },
        last_activity_at: Number(row.ord_updated_at) || 0,
        numbers: {
          reserved: [],
          pending_review: [],
          confirmed: [],
          bonus_confirmed: [],
          bonus_5plus1_confirmed: [],
          bonus_5plus2_confirmed: [],
        },
      };
      map.set(rid, entry);
    } else if ((Number(row.ord_updated_at) || 0) > entry.last_activity_at) {
      entry.last_activity_at = Number(row.ord_updated_at) || 0;
    }
    const n = Math.floor(Number(row.ticket_number));
    if (!Number.isFinite(n) || n < 1) continue;
    const st = String(row.order_status || "");
    if (st === "reserved") {
      if (!entry.numbers.reserved.includes(n)) entry.numbers.reserved.push(n);
      continue;
    }
    if (st === "pending_review") {
      if (!entry.numbers.pending_review.includes(n)) entry.numbers.pending_review.push(n);
      continue;
    }
    if (st === "confirmed") {
      if (Number(row.is_bonus) === 1) {
        if (!entry.numbers.bonus_confirmed.includes(n)) entry.numbers.bonus_confirmed.push(n);
        const kind = String(row.bonus_promo_kind || "").trim();
        if (kind === "5plus2") {
          if (!entry.numbers.bonus_5plus2_confirmed.includes(n)) entry.numbers.bonus_5plus2_confirmed.push(n);
        } else {
          if (!entry.numbers.bonus_5plus1_confirmed.includes(n)) entry.numbers.bonus_5plus1_confirmed.push(n);
        }
      } else if (!entry.numbers.confirmed.includes(n)) {
        entry.numbers.confirmed.push(n);
      }
    }
  }

  const out = [...map.values()];
  for (const it of out) {
    it.numbers.reserved.sort((a, b) => a - b);
    it.numbers.pending_review.sort((a, b) => a - b);
    it.numbers.confirmed.sort((a, b) => a - b);
    it.numbers.bonus_confirmed.sort((a, b) => a - b);
    it.numbers.bonus_5plus1_confirmed.sort((a, b) => a - b);
    it.numbers.bonus_5plus2_confirmed.sort((a, b) => a - b);
  }
  out.sort((a, b) => b.last_activity_at - a.last_activity_at);
  return out;
}

export type ParticipationHistorySummaryDto = {
  raffles_count: number;
  last_activity_at: number | null;
};

/** Лёгкая summary-версия истории участий (без разворачивания всех номерков). */
export async function getParticipationHistorySummaryForUser(userId: number): Promise<ParticipationHistorySummaryDto> {
  const row = await pgGet<{ raffles_count?: number; last_activity_at?: number | null }>(
    `SELECT COUNT(DISTINCT o.raffle_id) AS raffles_count, MAX(o.updated_at) AS last_activity_at
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ?
         AND o.status IN ('reserved', 'pending_review', 'confirmed')
         AND COALESCE(r.hidden_from_public, 0) = 0`,
    [userId],
  );
  return {
    raffles_count: Math.max(0, Number(row?.raffles_count || 0)),
    last_activity_at: row?.last_activity_at != null ? Number(row.last_activity_at) : null,
  };
}

export async function listPendingReviewTicketGroupsForUser(userId: number): Promise<
  Array<{
    order: ReturnType<typeof orderToDto>;
    numbers: number[];
    timeline: RaffleOrderTimelineItem[];
    raffle: { id: number; title: string; price_rub: number; status: string };
  }>
> {
  const rows = await pgAll<RaffleOrderRow & { raffle_title: string; raffle_price: number; raffle_status: string }>(
    `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price, r.status AS raffle_status
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.status = 'pending_review'
         AND COALESCE(r.hidden_from_public, 0) = 0
       ORDER BY o.id DESC`,
    [userId],
  );
  return await Promise.all(
    rows.map(async (row) => ({
      order: orderToDto(row),
      numbers: await getTicketNumbersForOrder(row.id),
      timeline: await listRaffleOrderTimeline(row.id),
      raffle: {
        id: row.raffle_id,
        title: row.raffle_title,
        price_rub: row.raffle_price,
        status: String(row.raffle_status || "active"),
      },
    })),
  );
}

export type MyTicketsSummaryDto = {
  reserved_count: number;
  pending_review_count: number;
  reserved_raffle_id: number | null;
  rejected_reason: string;
};

/** Облегченный summary для главной: без разворачивания групп и списков номерков. */
export async function getMyTicketsSummaryForUser(userId: number): Promise<MyTicketsSummaryDto> {
  await cleanupExpiredRaffleOrders();
  const now = Date.now();
  const reservedCountRow = await pgGet<{ c?: number }>(
    `SELECT COUNT(*) AS c
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ?
         AND o.status = 'reserved'
         AND o.reserved_until > ?
         AND COALESCE(r.hidden_from_public, 0) = 0`,
    [userId, now],
  );
  const pendingCountRow = await pgGet<{ c?: number }>(
    `SELECT COUNT(*) AS c
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ?
         AND o.status = 'pending_review'
         AND COALESCE(r.hidden_from_public, 0) = 0`,
    [userId],
  );
  const reservedOrderRow = await pgGet<{
    raffle_id?: number;
    last_reject_comment?: string | null;
    receipt_reject_count?: number;
  }>(
    `SELECT o.raffle_id AS raffle_id, o.last_reject_comment AS last_reject_comment, o.receipt_reject_count AS receipt_reject_count
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ?
         AND o.status = 'reserved'
         AND o.reserved_until > ?
         AND COALESCE(r.hidden_from_public, 0) = 0
       ORDER BY o.id DESC
       LIMIT 1`,
    [userId, now],
  );

  const rid = Math.floor(Number(reservedOrderRow?.raffle_id ?? 0));
  const rejected = Number(reservedOrderRow?.receipt_reject_count ?? 0) > 0;
  return {
    reserved_count: Math.max(0, Number(reservedCountRow?.c || 0)),
    pending_review_count: Math.max(0, Number(pendingCountRow?.c || 0)),
    reserved_raffle_id: Number.isFinite(rid) && rid > 0 ? rid : null,
    rejected_reason: rejected ? String(reservedOrderRow?.last_reject_comment || "").trim() : "",
  };
}

/** Быстрый вариант для /api/raffles/my-tickets: без timeline-запросов на каждый заказ. */
export async function listMyTicketsBundleForUser(userId: number): Promise<{
  reserved: Array<{
    order: ReturnType<typeof orderToDto>;
    numbers: number[];
    timeline: RaffleOrderTimelineItem[];
    raffle: { id: number; title: string; price_rub: number };
  }>;
  pending_review: Array<{
    order: ReturnType<typeof orderToDto>;
    numbers: number[];
    timeline: RaffleOrderTimelineItem[];
    raffle: { id: number; title: string; price_rub: number; status: string };
  }>;
  confirmed: Array<{
    order: ReturnType<typeof orderToDto>;
    numbers: number[];
    timeline: RaffleOrderTimelineItem[];
    raffle: { id: number; title: string; price_rub: number; status: string };
  }>;
}> {
  await cleanupExpiredRaffleOrders();
  const now = Date.now();
  const rows = await pgAll<RaffleOrderRow & { raffle_title: string; raffle_price: number; raffle_status: string }>(
    `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price, r.status AS raffle_status
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ?
         AND COALESCE(r.hidden_from_public, 0) = 0
         AND (
           o.status IN ('pending_review', 'confirmed')
           OR (o.status = 'reserved' AND o.reserved_until > ?)
         )
       ORDER BY o.id DESC`,
    [userId, now],
  );

  const orderIds = rows
    .map((row) => Math.floor(Number(row.id)))
    .filter((id) => Number.isFinite(id) && id > 0);
  const numbersByOrderId = new Map<number, number[]>();
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => "?").join(", ");
    const numRows = await pgAll<{ order_id: number; ticket_number: number }>(
      `SELECT order_id AS order_id, ticket_number AS ticket_number
         FROM raffle_ticket_holds
         WHERE order_id IN (${placeholders})
         ORDER BY order_id ASC, ticket_number ASC`,
      orderIds,
    );
    for (const nr of numRows) {
      const oid = Math.floor(Number(nr.order_id));
      if (!numbersByOrderId.has(oid)) numbersByOrderId.set(oid, []);
      numbersByOrderId.get(oid)!.push(Math.floor(Number(nr.ticket_number)));
    }
  }

  const reserved: Array<{
    order: ReturnType<typeof orderToDto>;
    numbers: number[];
    timeline: RaffleOrderTimelineItem[];
    raffle: { id: number; title: string; price_rub: number };
  }> = [];
  const pending_review: Array<{
    order: ReturnType<typeof orderToDto>;
    numbers: number[];
    timeline: RaffleOrderTimelineItem[];
    raffle: { id: number; title: string; price_rub: number; status: string };
  }> = [];
  const confirmed: Array<{
    order: ReturnType<typeof orderToDto>;
    numbers: number[];
    timeline: RaffleOrderTimelineItem[];
    raffle: { id: number; title: string; price_rub: number; status: string };
  }> = [];

  for (const row of rows) {
    const oid = Math.floor(Number(row.id));
    const base = {
      order: orderToDto(row),
      numbers: numbersByOrderId.get(oid) ?? [],
      timeline: [] as RaffleOrderTimelineItem[],
    };
    const raffleBase = {
      id: row.raffle_id,
      title: row.raffle_title,
      price_rub: row.raffle_price,
    };
    if (row.status === "reserved") {
      reserved.push({ ...base, raffle: raffleBase });
      continue;
    }
    if (row.status === "pending_review") {
      pending_review.push({
        ...base,
        raffle: { ...raffleBase, status: String(row.raffle_status || "active") },
      });
      continue;
    }
    if (row.status === "confirmed") {
      confirmed.push({
        ...base,
        raffle: { ...raffleBase, status: String(row.raffle_status || "active") },
      });
    }
  }

  return { reserved, pending_review, confirmed };
}

/**
 * Админ: билеты пользователя по «текущей» акции — последняя по id среди активных и видимых на сайте
 * (новая акция, а не первая по полю «Порядок»).
 */
export async function adminUserTicketsForPrimaryRaffle(userId: number): Promise<{
  raffle: { id: number; title: string; status: string } | null;
  reserved: Awaited<ReturnType<typeof listReservedOrdersForUser>>;
  pending_review: Awaited<ReturnType<typeof listPendingReviewTicketGroupsForUser>>;
  confirmed: Awaited<ReturnType<typeof listConfirmedTicketGroupsForUser>>;
  wholesale_numbers: number[];
}> {
  await cleanupExpiredRaffleOrders();
  const now = Date.now();
  const pub = await listRafflesPublic();
  const raffle = (await getLatestVisibleActiveRaffle()) ?? pub[0];
  if (!raffle) {
    return { raffle: null, reserved: [], pending_review: [], confirmed: [], wholesale_numbers: [] };
  }
  const rid = raffle.id;
  const wholesaleSlots = await listWholesaleSlotsForUser(userId);
  const wholesale_numbers = wholesaleSlots.find((s) => s.raffle_id === rid)?.wholesale_numbers ?? [];

  const reservedRows = await pgAll<RaffleOrderRow & { raffle_title: string; raffle_price: number }>(
    `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.raffle_id = ? AND o.status = 'reserved' AND o.reserved_until > ?
       ORDER BY o.id DESC`,
    [userId, rid, now],
  );

  const reserved = await Promise.all(
    reservedRows.map(async (row) => ({
      order: orderToDto(row),
      numbers: await getTicketNumbersForOrder(row.id),
      timeline: await listRaffleOrderTimeline(row.id),
      raffle: {
        id: row.raffle_id,
        title: row.raffle_title,
        price_rub: row.raffle_price,
      },
    })),
  );

  const pendingRows = await pgAll<
    RaffleOrderRow & { raffle_title: string; raffle_price: number; raffle_status: string }
  >(
    `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price, r.status AS raffle_status
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.raffle_id = ? AND o.status = 'pending_review'
       ORDER BY o.id DESC`,
    [userId, rid],
  );

  const pending_review = await Promise.all(
    pendingRows.map(async (row) => ({
      order: orderToDto(row),
      numbers: await getTicketNumbersForOrder(row.id),
      timeline: await listRaffleOrderTimeline(row.id),
      raffle: {
        id: row.raffle_id,
        title: row.raffle_title,
        price_rub: row.raffle_price,
        status: String(row.raffle_status || "active"),
      },
    })),
  );

  const confirmedRows = await pgAll<
    RaffleOrderRow & { raffle_title: string; raffle_price: number; raffle_status: string }
  >(
    `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price, r.status AS raffle_status
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.raffle_id = ? AND o.status = 'confirmed'
       ORDER BY o.id DESC`,
    [userId, rid],
  );

  const confirmed = await Promise.all(
    confirmedRows.map(async (row) => ({
      order: orderToDto(row),
      numbers: await getTicketNumbersForOrder(row.id),
      timeline: await listRaffleOrderTimeline(row.id),
      raffle: {
        id: row.raffle_id,
        title: row.raffle_title,
        price_rub: row.raffle_price,
        status: String(row.raffle_status || "active"),
      },
    })),
  );

  return {
    raffle: {
      id: raffle.id,
      title: raffle.title,
      status: String(raffle.status || "active"),
    },
    reserved,
    pending_review,
    confirmed,
    wholesale_numbers,
  };
}

/** Пересчёт номеров оптовиков: каждые N подтверждённых небонусных номерков у пользователя дают следующий глобальный № по времени подтверждения заказов. */
export async function recalculateWholesaleForRaffle(raffleId: number): Promise<void> {
  const raffle = await getRaffleById(raffleId);
  if (!raffle) return;
  await pgExec(`DELETE FROM raffle_wholesale_assignments WHERE raffle_id = ?`, [raffleId]);
  if (!Number(raffle.wholesale_enabled)) return;
  const everyN = Math.max(1, Math.floor(Number((raffle as { wholesale_every_n_tickets?: number }).wholesale_every_n_tickets ?? 10)));

  const rows = await pgAll<{ user_id: number; ticket_number: number; ord_u: number; oid: number }>(
    `SELECT h.user_id AS user_id, h.ticket_number AS ticket_number, o.updated_at AS ord_u, o.id AS oid
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND o.status = 'confirmed' AND COALESCE(h.is_bonus, 0) = 0
       ORDER BY o.updated_at ASC, o.id ASC, h.ticket_number ASC`,
    [raffleId],
  );

  const perUser = new Map<number, number>();
  let globalN = 0;
  const now = Date.now();

  for (const row of rows) {
    const uid = row.user_id;
    const c = (perUser.get(uid) ?? 0) + 1;
    perUser.set(uid, c);
    if (c % everyN !== 0) continue;
    globalN += 1;
    const slotIdx = c / everyN;
    await pgExec(
      `INSERT INTO raffle_wholesale_assignments (raffle_id, user_id, user_slot_index, wholesale_number, created_at)
     VALUES (?, ?, ?, ?, ?)`,
      [raffleId, uid, slotIdx, globalN, now],
    );
  }
}

/** Сколько бонусных номерков по акциям 5+1 и 5+2 закреплено подтверждёнными заказами. */
export async function recalculatePromoGiftStatsForRaffle(raffleId: number): Promise<void> {
  const raffle = await getRaffleById(raffleId);
  if (!raffle) return;
  const row = await pgGet<{ c1: number; c2: number }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE COALESCE(h.is_bonus, 0) = 1
           AND (h.bonus_promo_kind IS NULL OR h.bonus_promo_kind = '5plus1')
       )::bigint AS c1,
       COUNT(*) FILTER (WHERE COALESCE(h.is_bonus, 0) = 1 AND h.bonus_promo_kind = '5plus2')::bigint AS c2
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND o.status = 'confirmed'`,
    [raffleId],
  );
  await setRafflePromoGiftLockedCounts(raffleId, Number(row?.c1 ?? 0), Number(row?.c2 ?? 0));
}

export async function recalculateRaffleDerivedStatsForRaffle(raffleId: number): Promise<void> {
  await recalculateWholesaleForRaffle(raffleId);
  await recalculatePromoGiftStatsForRaffle(raffleId);
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
  user_locality: string;
};

/** Подтверждённые номерки без оплаты (админ): одна или несколько записей в одном заказе. */
export async function createOrAppendConfirmedTicketsForUser(
  raffleId: number,
  userId: number,
  numbers: number[],
  client?: PoolClient,
): Promise<void> {
  const raffle = await getRaffleById(raffleId);
  if (!raffle) throw new Error("NO_RAFFLE");
  const uniq = [...new Set(numbers.map((x) => Math.floor(Number(x))))].filter((n) => Number.isFinite(n));
  uniq.sort((a, b) => a - b);
  if (uniq.length === 0) return;
  for (const n of uniq) {
    if (n < 1 || n > raffle.ticket_count) throw new Error("BAD_NUM");
  }
  const now = Date.now();
  const existing = await pgGet<{ id: number; ticket_count: number; amount_rub: number }>(
    `SELECT id, ticket_count, amount_rub FROM raffle_orders WHERE raffle_id = ? AND user_id = ? AND status = 'confirmed' ORDER BY id DESC LIMIT 1`,
    [raffleId, userId],
    client,
  );

  if (existing) {
    const existingNums = new Set(await getTicketNumbersForOrder(existing.id, client));
    const toAdd = uniq.filter((n) => !existingNums.has(n));
    if (toAdd.length === 0) return;
    for (const n of toAdd) {
      if (await isRaffleTicketBlocked(raffleId, n, client)) throw new Error("OCCUPIED");
    }
    for (const n of toAdd) {
      await pgExec(
        `INSERT INTO raffle_ticket_holds (raffle_id, order_id, user_id, ticket_number, hold_status, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'confirmed', NULL, ?)`,
        [raffleId, existing.id, userId, n, now],
        client,
      );
    }
    const totalCount = existing.ticket_count + toAdd.length;
    const amount = totalCount * getRaffleEffectiveUnitPrice(raffle);
    await pgExec(`UPDATE raffle_orders SET amount_rub = ?, ticket_count = ?, updated_at = ? WHERE id = ?`, [
      amount,
      totalCount,
      now,
      existing.id,
    ], client);
    return;
  }

  for (const n of uniq) {
    if (await isRaffleTicketBlocked(raffleId, n, client)) throw new Error("OCCUPIED");
  }
  const cenopadApplied = isRaffleCenopadActive(raffle) ? 1 : 0;
  const amount = uniq.length * getRaffleEffectiveUnitPrice(raffle);
  const pubTok = newPublicOrderToken();
  const insRow = await pgGet<{ id: number }>(
    `INSERT INTO raffle_orders (
        raffle_id, user_id, bank, amount_rub, ticket_count, cenopad_applied, status,
        reserved_until, receipt_url, receipt_name, receipt_mime, public_status_token, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, 'confirmed', 0, NULL, NULL, NULL, ?, ?, ?) RETURNING id`,
    [raffleId, userId, amount, uniq.length, cenopadApplied, pubTok, now, now],
    client,
  );
  const orderId = Number(insRow?.id);
  if (!Number.isFinite(orderId) || orderId <= 0) throw new Error("INSERT_FAILED");
  await insertRaffleOrderEvent(orderId, "confirmed", null, client);
  for (const n of uniq) {
    await pgExec(
      `INSERT INTO raffle_ticket_holds (raffle_id, order_id, user_id, ticket_number, hold_status, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'confirmed', NULL, ?)`,
      [raffleId, orderId, userId, n, now],
      client,
    );
  }
}

/** Перенос предназначенных по телефону номерков в реальные подтверждённые заявки после регистрации/входа. Возвращает id акций, где что-то изменилось. */
export async function materializeRafflePreassignmentsForUser(userId: number): Promise<number[]> {
  const u = await getUserById(userId);
  if (!u) return [];
  const phone = u.phone;
  const rows = await pgAll<{ raffle_id: number; ticket_number: number }>(
    `SELECT raffle_id, ticket_number FROM raffle_phone_preassignments WHERE phone = ?`,
    [phone],
  );
  if (!rows.length) return [];

  const byRaffle = new Map<number, number[]>();
  for (const r of rows) {
    const arr = byRaffle.get(r.raffle_id) ?? [];
    arr.push(r.ticket_number);
    byRaffle.set(r.raffle_id, arr);
  }

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await pgExec(`DELETE FROM raffle_phone_preassignments WHERE phone = ?`, [phone], client);
    for (const [raffleId, nums] of byRaffle) {
      nums.sort((a, b) => a - b);
      await createOrAppendConfirmedTicketsForUser(raffleId, userId, nums, client);
    }
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

  const ids = [...byRaffle.keys()];
  for (const raffleId of ids) {
    await recalculateRaffleDerivedStatsForRaffle(raffleId);
  }
  return ids;
}

export type BulkAssignSkip = {
  line: number;
  phone: string;
  ticket_number: number;
  reason: string;
};

/** У телефона уже есть любой номерок в этой акции (бронь / проверка / подтверждённый или предназначение до регистрации). */
async function phoneHasAssignmentInRaffle(raffleId: number, phone: string): Promise<boolean> {
  const pre = await pgGet<{ x?: number }>(
    `SELECT 1 AS x FROM raffle_phone_preassignments WHERE raffle_id = ? AND phone = ? LIMIT 1`,
    [raffleId, phone],
  );
  if (pre) return true;
  const row = await pgGet<{ x?: number }>(
    `SELECT 1 AS x FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       INNER JOIN users u ON u.id = h.user_id
       WHERE h.raffle_id = ? AND u.phone = ? AND o.status NOT IN ('expired', 'rejected')
       LIMIT 1`,
    [raffleId, phone],
  );
  return Boolean(row);
}

async function ticketHeldByUserInRaffle(
  raffleId: number,
  ticketNumber: number,
  userId: number,
  client?: PoolClient,
): Promise<boolean> {
  const n = Math.floor(Number(ticketNumber));
  const uid = Math.floor(Number(userId));
  if (!Number.isFinite(n) || !Number.isFinite(uid)) return false;
  const row = await pgGet<{ x?: number }>(
    `SELECT 1 AS x FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND h.ticket_number = ? AND o.user_id = ? AND o.status NOT IN ('expired', 'rejected')
       LIMIT 1`,
    [raffleId, n, uid],
    client,
  );
  return Boolean(row);
}

async function preassignmentExactExists(
  raffleId: number,
  phone: string,
  ticketNumber: number,
  client?: PoolClient,
): Promise<boolean> {
  const n = Math.floor(Number(ticketNumber));
  if (!Number.isFinite(n)) return false;
  const row = await pgGet<{ x?: number }>(
    `SELECT 1 AS x FROM raffle_phone_preassignments WHERE raffle_id = ? AND phone = ? AND ticket_number = ? LIMIT 1`,
    [raffleId, phone, n],
    client,
  );
  return Boolean(row);
}

/**
 * Одна строка — один телефон; желаемый номерок = start + индекс строки среди непустых.
 * Если занят — берём следующий свободный до max.
 * Если у телефона уже есть номерок в акции или он уже получил номер в этой загрузке — строка пропускается (без второго номерка).
 */
export async function adminBulkAssignPhoneLinesToRaffle(
  raffleId: number,
  rawLines: string[],
  startNumber: number,
): Promise<
  { ok: true; assigned: number; skipped: BulkAssignSkip[]; affected_user_ids: number[] } | { ok: false; error: string }
> {
  const raffle = await getRaffleById(raffleId);
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

    if (await phoneHasAssignmentInRaffle(raffleId, p.phone)) {
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
      if (!virt.has(cand) && !(await isRaffleTicketBlocked(raffleId, cand))) {
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

  if (!valid.length) return { ok: true, assigned: 0, skipped, affected_user_ids: [] };

  const byPhone = new Map<string, Entry[]>();
  for (const e of valid) {
    const arr = byPhone.get(e.phone) ?? [];
    arr.push(e);
    byPhone.set(e.phone, arr);
  }

  const affectedUserIds = new Set<number>();
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    for (const [, list] of byPhone) {
      list.sort((a, b) => a.ticket_number - b.ticket_number);
      const tickets = list.map((x) => x.ticket_number);
      const phone = list[0]!.phone;
      const user = await getUserByPhone(phone);
      if (user) {
        await createOrAppendConfirmedTicketsForUser(raffleId, user.id, tickets, client);
        if (Number.isFinite(user.id) && user.id > 0) affectedUserIds.add(user.id);
      } else {
        const now = Date.now();
        for (const t of tickets) {
          await pgExec(
            `INSERT INTO raffle_phone_preassignments (raffle_id, ticket_number, phone, created_at) VALUES (?, ?, ?, ?)`,
            [raffleId, t, phone, now],
            client,
          );
        }
      }
    }
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

  await recalculateRaffleDerivedStatsForRaffle(raffleId);

  return { ok: true, assigned: valid.length, skipped, affected_user_ids: [...affectedUserIds] };
}

type AdminTicketAssignStep = { line: number; phone: string; wish: number };

async function sequentialAdminAssignTicketSteps(
  targetRaffleId: number,
  steps: AdminTicketAssignStep[],
): Promise<{
  assigned: number;
  skipped: BulkAssignSkip[];
  userTicketSets: Map<number, Set<number>>;
}> {
  const raffle = await getRaffleById(targetRaffleId);
  if (!raffle) throw new Error("NO_RAFFLE");
  const maxN = raffle.ticket_count;
  const skipped: BulkAssignSkip[] = [];
  const userTicketSets = new Map<number, Set<number>>();
  let assigned = 0;

  const trackUserTicket = (userId: number, wish: number): void => {
    const uid = Math.floor(Number(userId));
    if (!Number.isFinite(uid) || uid < 1) return;
    let s = userTicketSets.get(uid);
    if (!s) {
      s = new Set<number>();
      userTicketSets.set(uid, s);
    }
    s.add(wish);
  };

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    for (const p of steps) {
      const wish = Math.floor(Number(p.wish));
      if (!Number.isFinite(wish) || wish < 1 || wish > maxN) {
        skipped.push({
          line: p.line,
          phone: p.phone,
          ticket_number: wish,
          reason: "Номерок " + wish + " вне диапазона 1–" + maxN + " в этой акции",
        });
        continue;
      }

      const user = await getUserByPhone(p.phone);
      const blocked = await isRaffleTicketBlocked(targetRaffleId, wish, client);
      if (blocked) {
        if (user && Number.isFinite(user.id) && user.id > 0) {
          const alreadyTheirs = await ticketHeldByUserInRaffle(targetRaffleId, wish, user.id, client);
          if (alreadyTheirs) {
            assigned += 1;
            trackUserTicket(user.id, wish);
            continue;
          }
        } else {
          const preSame = await preassignmentExactExists(targetRaffleId, p.phone, wish, client);
          if (preSame) {
            assigned += 1;
            continue;
          }
        }
        skipped.push({
          line: p.line,
          phone: p.phone,
          ticket_number: wish,
          reason: "Номерок уже занят",
        });
        continue;
      }

      if (user && Number.isFinite(user.id) && user.id > 0) {
        try {
          await createOrAppendConfirmedTicketsForUser(targetRaffleId, user.id, [wish], client);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          skipped.push({
            line: p.line,
            phone: p.phone,
            ticket_number: wish,
            reason: msg.includes("OCCUPIED") ? "Номерок уже занят" : "Не удалось закрепить",
          });
          continue;
        }
        trackUserTicket(user.id, wish);
      } else {
        const now = Date.now();
        try {
          await pgExec(
            `INSERT INTO raffle_phone_preassignments (raffle_id, ticket_number, phone, created_at) VALUES (?, ?, ?, ?)`,
            [targetRaffleId, wish, p.phone, now],
            client,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isUnique =
            /unique/i.test(msg) ||
            (typeof err === "object" &&
              err !== null &&
              "code" in err &&
              String((err as { code?: string }).code) === "23505");
          if (isUnique && (await preassignmentExactExists(targetRaffleId, p.phone, wish, client))) {
            assigned += 1;
            continue;
          }
          skipped.push({
            line: p.line,
            phone: p.phone,
            ticket_number: wish,
            reason: isUnique ? "Номерок уже занят" : "Не удалось предназначить",
          });
          continue;
        }
      }
      assigned += 1;
    }
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

  return { assigned, skipped, userTicketSets };
}

/**
 * Номерки из списка (как в акции-источнике) → телефон владельца там же → закрепление в целевой акции
 * подряд: start, start+1, … (позиция в списке = смещение от start).
 */
export async function adminBulkAssignFromSourceRaffleTickets(
  targetRaffleId: number,
  sourceRaffleId: number,
  sourceTicketNumbers: number[],
  targetStartNumber: number,
): Promise<
  | {
      ok: true;
      assigned: number;
      skipped: BulkAssignSkip[];
      affected_user_ids: number[];
      notify_targets: { user_id: number; tickets: number[] }[];
    }
  | { ok: false; error: string }
> {
  const target = await getRaffleById(targetRaffleId);
  const source = await getRaffleById(sourceRaffleId);
  if (!target) return { ok: false, error: "Акция не найдена" };
  if (!source) return { ok: false, error: "Акция-источник не найдена" };
  if (!sourceTicketNumbers.length) return { ok: false, error: "Укажите хотя бы один номерок" };

  const sourceMax = source.ticket_count;
  const targetMax = target.ticket_count;
  const start = Math.max(1, Math.floor(Number(targetStartNumber)) || 1);

  const skipped: BulkAssignSkip[] = [];
  const steps: AdminTicketAssignStep[] = [];

  for (let i = 0; i < sourceTicketNumbers.length; i++) {
    const line = i + 1;
    const srcTn = Math.floor(Number(sourceTicketNumbers[i]));
    if (!Number.isFinite(srcTn)) {
      skipped.push({
        line,
        phone: "",
        ticket_number: NaN,
        reason: "Некорректное значение в списке",
      });
      continue;
    }
    if (srcTn < 1 || srcTn > sourceMax) {
      skipped.push({
        line,
        phone: "",
        ticket_number: srcTn,
        reason: "Номерок " + srcTn + " вне диапазона акции-источника (1–" + sourceMax + ")",
      });
      continue;
    }

    const phoneRaw = await getPhoneForTicketInRaffle(sourceRaffleId, srcTn);
    const phone = phoneRaw ? normalizePhone(String(phoneRaw)) : "";
    if (!phone || !isValidRuMobile(phone)) {
      skipped.push({
        line,
        phone: "",
        ticket_number: srcTn,
        reason: "Нет владельца номерка №" + srcTn + " в выбранной акции-источнике",
      });
      continue;
    }

    const wish = start + i;
    if (wish < 1 || wish > targetMax) {
      skipped.push({
        line,
        phone,
        ticket_number: wish,
        reason: "Номерок назначения №" + wish + " вне диапазона этой акции (1–" + targetMax + ")",
      });
      continue;
    }

    steps.push({ line, phone, wish });
  }

  if (steps.length === 0) {
    return {
      ok: true,
      assigned: 0,
      skipped,
      affected_user_ids: [],
      notify_targets: [],
    };
  }

  const seq = await sequentialAdminAssignTicketSteps(targetRaffleId, steps);
  await recalculateRaffleDerivedStatsForRaffle(targetRaffleId);

  const allSkipped = skipped.concat(seq.skipped);
  const notify_targets = [...seq.userTicketSets.entries()].map(([user_id, set]) => ({
    user_id,
    tickets: [...set].sort((a, b) => a - b),
  }));
  const affected_user_ids = [...seq.userTicketSets.keys()];

  return {
    ok: true,
    assigned: seq.assigned,
    skipped: allSkipped,
    affected_user_ids,
    notify_targets,
  };
}

export async function adminAssignPhoneToExactTicket(
  raffleId: number,
  rawPhone: string,
  ticketNumber: number,
): Promise<{ ok: true; affected_user_id: number | null } | { ok: false; error: string }> {
  const raffle = await getRaffleById(raffleId);
  if (!raffle) return { ok: false, error: "Акция не найдена" };
  const phone = normalizePhone(String(rawPhone || ""));
  if (!phone || !isValidRuMobile(phone)) {
    return { ok: false, error: "Некорректный мобильный номер РФ" };
  }
  const n = Math.floor(Number(ticketNumber));
  if (!Number.isFinite(n) || n < 1 || n > raffle.ticket_count) {
    return { ok: false, error: "Некорректный номерок" };
  }
  if (await isRaffleTicketBlocked(raffleId, n)) {
    return { ok: false, error: "Номерок уже занят" };
  }
  const user = await getUserByPhone(phone);
  if (user) {
    await createOrAppendConfirmedTicketsForUser(raffleId, user.id, [n]);
  } else {
    await pgExec(
      `INSERT INTO raffle_phone_preassignments (raffle_id, ticket_number, phone, created_at) VALUES (?, ?, ?, ?)`,
      [raffleId, n, phone, Date.now()],
    );
  }
  await recalculateRaffleDerivedStatsForRaffle(raffleId);
  return { ok: true, affected_user_id: user ? user.id : null };
}

export async function getAdminRaffleParticipantsBundle(raffleId: number): Promise<{
  wholesale_enabled: boolean;
  wholesale_every_n_tickets: number;
  participants: AdminRaffleParticipantView[];
  wholesalers: AdminWholesalerRow[];
}> {
  const page = await listAdminRaffleParticipantsPage(raffleId, { offset: 0, limit: 100000, search: "" });
  const wholesalers = await listAdminRaffleWholesalers(raffleId);
  return {
    wholesale_enabled: page.wholesale_enabled,
    wholesale_every_n_tickets: page.wholesale_every_n_tickets,
    participants: page.participants,
    wholesalers,
  };
}

function normalizeAdminParticipantsSearch(raw: string): { kind: "ticket" | "phone"; value: string } | null {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.length >= 7) return { kind: "phone", value: digits };
  return { kind: "ticket", value: digits };
}

export async function listAdminRaffleWholesalers(raffleId: number): Promise<AdminWholesalerRow[]> {
  const raffle = await getRaffleById(raffleId);
  const wholesale_enabled = Boolean(raffle && Number(raffle.wholesale_enabled));
  if (!wholesale_enabled) return [];
  return pgAll<AdminWholesalerRow>(
    `SELECT w.wholesale_number AS wholesale_number, u.phone AS user_phone
       FROM raffle_wholesale_assignments w
       INNER JOIN users u ON u.id = w.user_id
       WHERE w.raffle_id = ?
       ORDER BY w.wholesale_number ASC`,
    [raffleId],
  );
}

export async function listAdminRaffleParticipantsPage(
  raffleId: number,
  opts?: { offset?: number; limit?: number; search?: string },
): Promise<{
  wholesale_enabled: boolean;
  wholesale_every_n_tickets: number;
  participants: AdminRaffleParticipantView[];
  total: number;
}> {
  await cleanupExpiredRaffleOrders();
  const raffle = await getRaffleById(raffleId);
  const wholesale_enabled = Boolean(raffle && Number(raffle.wholesale_enabled));
  const wholesale_every_n_tickets = Math.max(
    1,
    Math.floor(Number((raffle as { wholesale_every_n_tickets?: number } | undefined)?.wholesale_every_n_tickets ?? 10)),
  );
  const limit = Math.min(Math.max(1, Math.floor(Number(opts?.limit) || 120)), 500);
  const offset = Math.max(0, Math.floor(Number(opts?.offset) || 0));
  const parsed = normalizeAdminParticipantsSearch(String(opts?.search || ""));
  const holdParams: unknown[] = [raffleId];
  const preParams: unknown[] = [raffleId];
  let holdExtra = "";
  let preExtra = "";
  if (parsed) {
    if (parsed.kind === "phone") {
      const pat = `%${parsed.value}%`;
      holdExtra = ` AND regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE ?`;
      preExtra = ` AND regexp_replace(COALESCE(p.phone, ''), '\\D', '', 'g') LIKE ?`;
      holdParams.push(pat);
      preParams.push(pat);
    } else {
      const pat = `${parsed.value}%`;
      holdExtra = ` AND CAST(h.ticket_number AS TEXT) LIKE ?`;
      preExtra = ` AND CAST(p.ticket_number AS TEXT) LIKE ?`;
      holdParams.push(pat);
      preParams.push(pat);
    }
  }
  const totalRow = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c
     FROM (
       SELECT h.ticket_number
         FROM raffle_ticket_holds h
         INNER JOIN raffle_orders o ON o.id = h.order_id
         INNER JOIN users u ON u.id = o.user_id
        WHERE h.raffle_id = ? AND o.status NOT IN ('expired', 'rejected')${holdExtra}
       UNION ALL
       SELECT p.ticket_number
         FROM raffle_phone_preassignments p
        WHERE p.raffle_id = ?${preExtra}
     ) t`,
    [...holdParams, ...preParams],
  );
  const rows = await pgAll<{
    ticket_number: number;
    user_phone: string;
    order_status: string;
    is_wholesale: number;
    user_id: number;
    user_name: string;
    user_email: string;
    user_locality: string;
  }>(
    `WITH confirmed_counts AS (
       SELECT h.user_id AS user_id, COUNT(*)::int AS c
         FROM raffle_ticket_holds h
         INNER JOIN raffle_orders o ON o.id = h.order_id
        WHERE h.raffle_id = ? AND o.status = 'confirmed' AND COALESCE(h.is_bonus, 0) = 0
        GROUP BY h.user_id
     )
     SELECT * FROM (
       SELECT h.ticket_number AS ticket_number,
              u.phone AS user_phone,
              o.status AS order_status,
              CASE WHEN ? = 1 AND COALESCE(cc.c, 0) >= ? THEN 1 ELSE 0 END AS is_wholesale,
              h.user_id AS user_id,
              u.name AS user_name,
              COALESCE(u.email, '') AS user_email,
              COALESCE(u.locality, '') AS user_locality
         FROM raffle_ticket_holds h
         INNER JOIN raffle_orders o ON o.id = h.order_id
         INNER JOIN users u ON u.id = o.user_id
         LEFT JOIN confirmed_counts cc ON cc.user_id = h.user_id
        WHERE h.raffle_id = ? AND o.status NOT IN ('expired', 'rejected')${holdExtra}
       UNION ALL
       SELECT p.ticket_number AS ticket_number,
              p.phone AS user_phone,
              'preassigned' AS order_status,
              0 AS is_wholesale,
              0 AS user_id,
              '' AS user_name,
              '' AS user_email,
              '' AS user_locality
         FROM raffle_phone_preassignments p
        WHERE p.raffle_id = ?${preExtra}
     ) x
     ORDER BY ticket_number ASC
     LIMIT ? OFFSET ?`,
    [raffleId, wholesale_enabled ? 1 : 0, wholesale_every_n_tickets, ...holdParams, ...preParams, limit, offset],
  );
  return {
    wholesale_enabled,
    wholesale_every_n_tickets,
    participants: rows.map((row) => ({
      ticket_number: row.ticket_number,
      user_phone: row.user_phone,
      order_status: row.order_status,
      is_wholesale: Number(row.is_wholesale) === 1,
      user_id: row.user_id,
      user_name: row.user_name ?? "",
      user_email: row.user_email ?? "",
      user_locality: row.user_locality ?? "",
    })),
    total: Number(totalRow?.c ?? 0),
  };
}

/** Номера оптовика пользователя по акциям (для экрана «Мои билеты»). */
export async function listWholesaleSlotsForUser(
  userId: number,
): Promise<Array<{ raffle_id: number; wholesale_numbers: number[] }>> {
  const rows = await pgAll<{ raffle_id: number; wholesale_number: number }>(
    `SELECT raffle_id, wholesale_number FROM raffle_wholesale_assignments WHERE user_id = ? ORDER BY raffle_id ASC, wholesale_number ASC`,
    [userId],
  );
  const map = new Map<number, number[]>();
  for (const r of rows) {
    const arr = map.get(r.raffle_id) ?? [];
    arr.push(r.wholesale_number);
    map.set(r.raffle_id, arr);
  }
  return [...map.entries()].map(([raffle_id, wholesale_numbers]) => ({ raffle_id, wholesale_numbers }));
}

export async function addTicketsToReservedOrder(
  orderId: number,
  userId: number,
  newNumbers: number[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  await cleanupExpiredRaffleOrders();
  const o = await getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Можно добавлять только к активной брони" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const raffle = await getRaffleById(o.raffle_id);
  if (!raffle) return { ok: false, error: "Акция не найдена" };

  const existing = new Set(await getTicketNumbersForOrder(orderId));
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
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    for (const n of toAdd) {
      if (await isRaffleTicketBlocked(o.raffle_id, n, client)) throw new Error("OCCUPIED");
    }
    for (const n of toAdd) {
      await pgExec(
        `INSERT INTO raffle_ticket_holds (raffle_id, order_id, user_id, ticket_number, hold_status, expires_at, created_at)
         VALUES (?, ?, ?, ?, 'reserved', ?, ?)`,
        [o.raffle_id, orderId, userId, n, reservedUntil, now],
        client,
      );
    }
    const allCount = existing.size + toAdd.length;
    const unitPrice = resolveOrderUnitPrice(o, getRaffleEffectiveUnitPrice(raffle));
    const amount = allCount * unitPrice;
    await pgExec(`UPDATE raffle_orders SET amount_rub = ?, ticket_count = ?, updated_at = ? WHERE id = ?`, [
      amount,
      allCount,
      now,
      orderId,
    ], client);
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    if (e instanceof Error && e.message === "OCCUPIED") {
      return { ok: false, error: "Один или несколько номерков уже заняты" };
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function appendRandomTicketsToReservedOrder(
  orderId: number,
  userId: number,
  want: number,
): Promise<{ ok: true; picked: number[] } | { ok: false; error: string }> {
  await cleanupExpiredRaffleOrders();
  const o = await getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Можно добавлять только к активной брони" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const raffle = await getRaffleById(o.raffle_id);
  if (!raffle) return { ok: false, error: "Акция не найдена" };

  const existing = await getTicketNumbersForOrder(orderId);
  const slots = RAFFLE_MAX_SELECT - existing.length;
  const nPick = Math.min(Math.max(1, Math.floor(want)), slots);
  if (nPick < 1) return { ok: false, error: "Достигнут лимит номерков" };

  const occupiedRows = await pgAll<{ ticket_number: number }>(
    `SELECT h.ticket_number FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o2 ON o2.id = h.order_id
       WHERE h.raffle_id = ? AND o2.status NOT IN ('expired', 'rejected')`,
    [o.raffle_id],
  );
  const preRows = await pgAll<{ ticket_number: number }>(
    `SELECT ticket_number FROM raffle_phone_preassignments WHERE raffle_id = ?`,
    [o.raffle_id],
  );
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
  const add = await addTicketsToReservedOrder(orderId, userId, picked);
  if (!add.ok) return { ok: false, error: "error" in add ? add.error : "Неизвестная ошибка" };
  return { ok: true, picked };
}

/** Сколько номерков уже занято по акции (бронь/проверка/подтверждено + предназначения по телефону). */
export async function getRaffleOccupiedCount(raffleId: number): Promise<number> {
  await cleanupExpiredRaffleOrders();
  const holds = await pgGet<{ c: number }>(
    `SELECT COUNT(*) AS c
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id = ? AND o.status NOT IN ('expired', 'rejected')`,
    [raffleId],
  );
  const pre = await pgGet<{ c: number }>(`SELECT COUNT(*) AS c FROM raffle_phone_preassignments WHERE raffle_id = ?`, [
    raffleId,
  ]);
  return Math.max(0, Number((holds && holds.c) || 0) + Number((pre && pre.c) || 0));
}

export function buildStaffTicketAssignmentChatBody(
  raffleTitle: string,
  ticketNumbers: number[],
  adminNote?: string,
): string {
  const safeTitle = String(raffleTitle || "акция")
    .trim()
    .slice(0, 180);
  const nums = [
    ...new Set(
      ticketNumbers.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0),
    ),
  ].sort((a, b) => a - b);
  let head: string;
  if (nums.length === 0) {
    head = `Вам закреплены номерки по акции «${safeTitle}».`;
  } else if (nums.length === 1) {
    head = `Вам закреплён номерок №${nums[0]} по акции «${safeTitle}».`;
  } else {
    head = `Вам закреплены номерки ` + nums.map((n) => `№${n}`).join(", ") + ` по акции «${safeTitle}».`;
  }
  const note = String(adminNote ?? "").trim().slice(0, 500);
  if (!note) return head;
  return `${head}\n\n${note}`;
}

export async function notifyUserTicketAssignment(
  userId: number,
  raffleTitle: string,
  ticketNumbers: number[],
  adminNote?: string,
): Promise<number> {
  const body = buildStaffTicketAssignmentChatBody(raffleTitle, ticketNumbers, adminNote);
  return insertSupportMessage(userId, body, true, null);
}

export async function adminAssignRandomTicketsToPhone(
  raffleId: number,
  rawPhone: string,
  count: number,
): Promise<{ ok: true; ticket_numbers: number[] } | { ok: false; error: string }> {
  const need = Math.max(1, Math.floor(Number(count) || 1));
  const assigned: number[] = [];
  const tried = new Set<number>();

  for (let round = 0; round < 3 && assigned.length < need; round++) {
    const free = (await listGloballyFreeTicketNumbers(raffleId)).filter((t) => !assigned.includes(t));
    if (free.length === 0) break;
    const pool = [...free];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    for (const ticket of pool) {
      if (assigned.length >= need) break;
      if (tried.has(ticket)) continue;
      tried.add(ticket);
      const res = await adminAssignPhoneToExactTicket(raffleId, rawPhone, ticket);
      if (res.ok) assigned.push(ticket);
    }
  }

  if (assigned.length < need) {
    return {
      ok: false,
      error: `Не удалось закрепить ${need} номерков (закреплено ${assigned.length}). Проверьте свободные номерки в акции.`,
    };
  }
  assigned.sort((a, b) => a - b);
  return { ok: true, ticket_numbers: assigned };
}
