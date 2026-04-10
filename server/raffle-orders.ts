import { db, getRaffleById, isRaffleVisibleOnSite } from "./db.js";

export const RAFFLE_RESERVE_MS = 15 * 60 * 1000;
export const RAFFLE_MAX_SELECT = 10;

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
  receipt_url: string | null;
  receipt_name: string | null;
  receipt_mime: string | null;
  created_at: number;
  updated_at: number;
};

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

export function getTicketCellKind(
  raffleId: number,
  ticketNumber: number,
  currentUserId: number,
): TicketCellKind {
  const row = getHoldForNumber(raffleId, ticketNumber);
  if (!row) return "free";
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
  const free_count = Math.max(0, maxN - (occupied?.c ?? 0));
  return { cells, free_count };
}

export function createReservation(
  raffleId: number,
  userId: number,
  numbers: number[],
): { ok: true; order_id: number; reserved_until: number } | { ok: false; error: string } {
  cleanupExpiredRaffleOrders();
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
  const reservedUntil = now + RAFFLE_RESERVE_MS;
  const amount = uniq.length * raffle.price_rub;

  try {
    const tx = db.transaction(() => {
      for (const n of uniq) {
        const taken = db
          .prepare(
            `SELECT 1 FROM raffle_ticket_holds h
             INNER JOIN raffle_orders o ON o.id = h.order_id
             WHERE h.raffle_id = ? AND h.ticket_number = ? AND o.status NOT IN ('expired', 'rejected')`,
          )
          .get(raffleId, n);
        if (taken) throw new Error("OCCUPIED");
      }
      const info = db
        .prepare(
          `INSERT INTO raffle_orders (
            raffle_id, user_id, bank, amount_rub, ticket_count, status,
            reserved_until, receipt_url, receipt_name, receipt_mime, created_at, updated_at
          ) VALUES (?, ?, NULL, ?, ?, 'reserved', ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          raffleId,
          userId,
          amount,
          uniq.length,
          reservedUntil,
          now,
          now,
        );
      const orderId = Number(info.lastInsertRowid);
      const ins = db.prepare(
        `INSERT INTO raffle_ticket_holds (raffle_id, order_id, user_id, ticket_number, hold_status, expires_at, created_at)
         VALUES (?, ?, ?, ?, 'reserved', ?, ?)`,
      );
      for (const n of uniq) {
        ins.run(raffleId, orderId, userId, n, reservedUntil, now);
      }
      return orderId;
    });
    const orderId = tx();
    return { ok: true, order_id: orderId, reserved_until: reservedUntil };
  } catch (e) {
    if (e instanceof Error && e.message === "OCCUPIED") {
      return { ok: false, error: "Один или несколько номерков уже заняты" };
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
  receipt: { url: string; name: string; mime: string },
): { ok: true } | { ok: false; error: string } {
  cleanupExpiredRaffleOrders();
  if (!/^\/uploads\/receipts\/[a-zA-Z0-9._-]+$/.test(receipt.url)) {
    return { ok: false, error: "Некорректная ссылка на чек" };
  }
  const o = getOrderByIdForUser(orderId, userId);
  if (!o) return { ok: false, error: "Заявка не найдена" };
  if (o.status !== "reserved") return { ok: false, error: "Чек можно прикрепить только к активной брони" };
  if (Date.now() > o.reserved_until) return { ok: false, error: "Время брони истекло" };
  const now = Date.now();
  db.prepare(
    `UPDATE raffle_orders SET receipt_url = ?, receipt_name = ?, receipt_mime = ?, status = 'pending_review', updated_at = ? WHERE id = ?`,
  ).run(receipt.url, receipt.name, receipt.mime, now, orderId);
  db.prepare(
    `UPDATE raffle_ticket_holds SET hold_status = 'payment_pending', expires_at = NULL WHERE order_id = ?`,
  ).run(orderId);
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
  db.prepare(`UPDATE raffle_orders SET status = 'confirmed', updated_at = ? WHERE id = ?`).run(
    now,
    orderId,
  );
  db.prepare(
    `UPDATE raffle_ticket_holds SET hold_status = 'confirmed' WHERE order_id = ?`,
  ).run(orderId);
  recalculateWholesaleForRaffle(raffleId);
  return { ok: true };
}

export function rejectOrderByAdmin(orderId: number): { ok: true } | { ok: false; error: string } {
  const o = getOrderById(orderId);
  if (!o) return { ok: false, error: "Не найдено" };
  if (o.status !== "pending_review") return { ok: false, error: "Неверный статус" };
  const now = Date.now();
  const raffleId = o.raffle_id;
  db.prepare(`DELETE FROM raffle_ticket_holds WHERE order_id = ?`).run(orderId);
  db.prepare(`UPDATE raffle_orders SET status = 'rejected', updated_at = ? WHERE id = ?`).run(
    now,
    orderId,
  );
  recalculateWholesaleForRaffle(raffleId);
  return { ok: true };
}

export function orderToDto(o: RaffleOrderRow) {
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
    `UPDATE raffle_orders SET reserved_until = ?, reserve_extended_once = 1, updated_at = ? WHERE id = ?`,
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
       ORDER BY o.id DESC`,
    )
    .all(userId, now) as Array<RaffleOrderRow & { raffle_title: string; raffle_price: number }>;
  return rows.map((row) => ({
    order: orderToDto(row),
    numbers: getTicketNumbersForOrder(row.id),
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

export function listConfirmedTicketGroupsForUser(userId: number): Array<{
  order: ReturnType<typeof orderToDto>;
  numbers: number[];
  raffle: { id: number; title: string; price_rub: number; status: string };
}> {
  const rows = db
    .prepare(
      `SELECT o.*, r.title AS raffle_title, r.price_rub AS raffle_price, r.status AS raffle_status
       FROM raffle_orders o
       INNER JOIN raffles r ON r.id = o.raffle_id
       WHERE o.user_id = ? AND o.status = 'confirmed'
       ORDER BY o.id DESC`,
    )
    .all(userId) as Array<
    RaffleOrderRow & { raffle_title: string; raffle_price: number; raffle_status: string }
  >;
  return rows.map((row) => ({
    order: orderToDto(row),
    numbers: getTicketNumbersForOrder(row.id),
    raffle: {
      id: row.raffle_id,
      title: row.raffle_title,
      price_rub: row.raffle_price,
      status: String(row.raffle_status || "active"),
    },
  }));
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

  const participants: AdminRaffleParticipantView[] = partRows.map((row) => ({
    ticket_number: row.ticket_number,
    user_phone: row.user_phone,
    order_status: row.order_status,
    is_wholesale:
      wholesale_enabled && (countMap.get(row.user_id) ?? 0) >= 10,
    user_id: row.user_id,
    user_name: row.user_name ?? "",
    user_email: row.user_email ?? "",
  }));

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
        const taken = db
          .prepare(
            `SELECT 1 FROM raffle_ticket_holds h
             INNER JOIN raffle_orders o2 ON o2.id = h.order_id
             WHERE h.raffle_id = ? AND h.ticket_number = ? AND o2.status NOT IN ('expired', 'rejected')`,
          )
          .get(o.raffle_id, n);
        if (taken) throw new Error("OCCUPIED");
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
  const occ = new Set(occupiedRows.map((r) => r.ticket_number));

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
