import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { getUserById, getUserByPhone, insertSupportMessage } from "./db.js";
import { isStaffRole } from "./admin-roles.js";
import { isValidRuMobile, normalizePhone } from "./phone.js";
import { pgAll, pgExec, pgGet } from "./pg-sql.js";
import { pgPool } from "./pg.js";
import {
  formatRuSiteDateTime,
  formatSiteDateTimeLocalFromUtcMs,
  getSiteCalendarDayBoundsUtcMs,
  getSiteCalendarDayKey,
  parseSiteDateTimeLocalToUtcMs,
  SITE_TIMEZONE_LABEL,
} from "./site-timezone.js";

export type BonusTableAccessMode = "link" | "closed";
export type BonusTableViewPrivacy = "participants_admins" | "all_auth" | "admins_only";
export type BonusTableCountFrom = "table_created" | "include_prior_same_day";
export type BonusTableAggregation = "per_order" | "cumulative";
export type BonusTablePeriodScope = "same_day" | "full_period";
export type BonusTableStatus = "draft" | "active" | "ended";

export type RaffleBonusTableRow = {
  id: number;
  raffle_id: number;
  title: string;
  description: string;
  access_mode: BonusTableAccessMode;
  view_privacy: BonusTableViewPrivacy;
  public_slug: string;
  start_at: number;
  end_at: number;
  count_from: BonusTableCountFrom;
  tickets_required: number;
  bonus_slots_per_reward: number;
  aggregation: BonusTableAggregation;
  period_scope: BonusTablePeriodScope;
  status: BonusTableStatus;
  created_by_user_id: number | null;
  created_at: number;
  updated_at: number;
};

export type RaffleBonusTableEntryRow = {
  id: number;
  bonus_table_id: number;
  user_id: number;
  user_phone: string;
  position: number;
  order_id: number | null;
  qualifying_ticket_count: number;
  qualifying_ticket_numbers: string;
  chat_notified: number;
  created_at: number;
};

export type BonusTableDto = {
  id: number;
  raffle_id: number;
  title: string;
  description: string;
  access_mode: BonusTableAccessMode;
  view_privacy: BonusTableViewPrivacy;
  public_slug: string;
  public_url: string | null;
  start_at: number;
  end_at: number;
  start_at_local: string;
  end_at_local: string;
  count_from: BonusTableCountFrom;
  tickets_required: number;
  bonus_slots_per_reward: number;
  aggregation: BonusTableAggregation;
  period_scope: BonusTablePeriodScope;
  status: BonusTableStatus;
  entry_count: number;
  condition_label: string;
  created_at: number;
  updated_at: number;
};

export type BonusTableEntryDto = {
  position: number;
  phone: string;
  is_mine: boolean;
  created_at: number;
};

export type BonusTableAwardResult = {
  table_id: number;
  table_title: string;
  public_slug: string;
  positions: number[];
};

function nowMs() {
  return Date.now();
}

function generatePublicSlug(): string {
  return randomBytes(10).toString("base64url").slice(0, 14);
}

function appPublicOrigin(): string {
  const u = process.env.APP_PUBLIC_URL?.trim() || process.env.SITE_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://127.0.0.1:4321";
}

export function buildBonusTableConditionLabel(row: Pick<
  RaffleBonusTableRow,
  "tickets_required" | "bonus_slots_per_reward" | "aggregation" | "period_scope"
>): string {
  const n = Math.max(1, Math.floor(Number(row.tickets_required) || 1));
  const m = Math.max(1, Math.floor(Number(row.bonus_slots_per_reward) || 1));
  const agg = row.aggregation === "per_order" ? "разом" : "разом или в общем";
  const period = row.period_scope === "same_day" ? "за сегодня" : "за период акции";
  const reward = m === 1 ? "+1 место в бонусной таблице" : `+${m} места в бонусной таблице`;
  return `Купи ${n} номерка ${period} (${agg}) — ${reward}`;
}

function bonusTableToDto(row: RaffleBonusTableRow, entryCount = 0): BonusTableDto {
  const slug = String(row.public_slug || "").trim();
  const publicUrl =
    row.access_mode === "link" && slug ? `${appPublicOrigin()}/home/bonus-table/${encodeURIComponent(slug)}` : null;
  return {
    id: row.id,
    raffle_id: row.raffle_id,
    title: row.title,
    description: String(row.description || ""),
    access_mode: row.access_mode,
    view_privacy: row.view_privacy,
    public_slug: slug,
    public_url: publicUrl,
    start_at: row.start_at,
    end_at: row.end_at,
    start_at_local: formatSiteDateTimeLocalFromUtcMs(row.start_at),
    end_at_local: formatSiteDateTimeLocalFromUtcMs(row.end_at),
    count_from: row.count_from,
    tickets_required: row.tickets_required,
    bonus_slots_per_reward: row.bonus_slots_per_reward,
    aggregation: row.aggregation,
    period_scope: row.period_scope,
    status: row.status,
    entry_count: entryCount,
    condition_label: buildBonusTableConditionLabel(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseTicketNumbersJson(raw: string): number[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return [
      ...new Set(arr.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0)),
    ].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function periodKeyForTable(table: RaffleBonusTableRow, atMs: number): string {
  if (table.period_scope === "full_period") return "";
  return getSiteCalendarDayKey(atMs);
}

function isWithinTableWindow(table: RaffleBonusTableRow, atMs: number): boolean {
  const t = Math.floor(Number(atMs));
  if (!Number.isFinite(t) || t <= 0) return false;
  if (table.status !== "active") return false;
  return t >= table.start_at && t <= table.end_at;
}

function orderCountsForTable(table: RaffleBonusTableRow, confirmedAt: number, tableCreatedAt: number): boolean {
  if (table.count_from === "include_prior_same_day") {
    const createdDay = getSiteCalendarDayKey(tableCreatedAt);
    const orderDay = getSiteCalendarDayKey(confirmedAt);
    if (createdDay && orderDay && createdDay === orderDay) return true;
    return confirmedAt >= tableCreatedAt;
  }
  return confirmedAt >= tableCreatedAt;
}

async function getPaidTicketCountForOrder(orderId: number, client?: PoolClient): Promise<number> {
  const row = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM raffle_ticket_holds
     WHERE order_id = ? AND COALESCE(is_bonus, 0) = 0`,
    [orderId],
    client,
  );
  return Math.max(0, Math.floor(Number(row?.c) || 0));
}

async function getPaidTicketNumbersForOrder(orderId: number, client?: PoolClient): Promise<number[]> {
  const rows = await pgAll<{ ticket_number: number }>(
    `SELECT ticket_number FROM raffle_ticket_holds
     WHERE order_id = ? AND COALESCE(is_bonus, 0) = 0
     ORDER BY ticket_number ASC`,
    [orderId],
    client,
  );
  return rows.map((r) => Math.floor(Number(r.ticket_number))).filter((n) => Number.isFinite(n) && n > 0);
}

async function getNextPositions(tableId: number, count: number, client?: PoolClient): Promise<number[]> {
  const row = await pgGet<{ max_pos: number | null }>(
    `SELECT MAX(position)::int AS max_pos FROM raffle_bonus_table_entries WHERE bonus_table_id = ?`,
    [tableId],
    client,
  );
  const start = Math.max(0, Math.floor(Number(row?.max_pos) || 0)) + 1;
  return Array.from({ length: count }, (_, i) => start + i);
}

async function getProgressRemainder(
  tableId: number,
  userId: number,
  periodKey: string,
  client?: PoolClient,
): Promise<number> {
  const row = await pgGet<{ remainder_tickets: number }>(
    `SELECT remainder_tickets FROM raffle_bonus_table_progress
     WHERE bonus_table_id = ? AND user_id = ? AND period_key = ?`,
    [tableId, userId, periodKey],
    client,
  );
  return Math.max(0, Math.floor(Number(row?.remainder_tickets) || 0));
}

async function setProgressRemainder(
  tableId: number,
  userId: number,
  periodKey: string,
  remainder: number,
  client?: PoolClient,
): Promise<void> {
  const rem = Math.max(0, Math.floor(Number(remainder) || 0));
  await pgExec(
    `INSERT INTO raffle_bonus_table_progress (bonus_table_id, user_id, period_key, remainder_tickets)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (bonus_table_id, user_id, period_key)
     DO UPDATE SET remainder_tickets = EXCLUDED.remainder_tickets`,
    [tableId, userId, periodKey, rem],
    client,
  );
}

function calculateSlotsToAward(
  table: RaffleBonusTableRow,
  paidCount: number,
  remainder: number,
): { slots: number; newRemainder: number } {
  const req = Math.max(1, Math.floor(Number(table.tickets_required) || 1));
  const reward = Math.max(1, Math.floor(Number(table.bonus_slots_per_reward) || 1));
  if (table.aggregation === "per_order") {
    const slots = paidCount >= req ? Math.floor(paidCount / req) * reward : 0;
    return { slots, newRemainder: 0 };
  }
  const total = remainder + paidCount;
  const slots = Math.floor(total / req) * reward;
  const newRemainder = total % req;
  return { slots, newRemainder };
}

async function insertBonusEntries(input: {
  table: RaffleBonusTableRow;
  userId: number;
  userPhone: string;
  orderId: number | null;
  slots: number;
  paidCount: number;
  ticketNumbers: number[];
  client?: PoolClient;
}): Promise<number[]> {
  if (input.slots <= 0) return [];
  const positions = await getNextPositions(input.table.id, input.slots, input.client);
  const ts = nowMs();
  const numsJson = JSON.stringify(input.ticketNumbers);
  for (const pos of positions) {
    await pgExec(
      `INSERT INTO raffle_bonus_table_entries (
        bonus_table_id, user_id, user_phone, position, order_id,
        qualifying_ticket_count, qualifying_ticket_numbers, chat_notified, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        input.table.id,
        input.userId,
        input.userPhone,
        pos,
        input.orderId,
        input.paidCount,
        numsJson,
        ts,
      ],
      input.client,
    );
  }
  return positions;
}

async function processOrderForTable(
  table: RaffleBonusTableRow,
  orderId: number,
  userId: number,
  userPhone: string,
  confirmedAt: number,
  client?: PoolClient,
): Promise<number[]> {
  if (!isWithinTableWindow(table, confirmedAt)) return [];
  if (!orderCountsForTable(table, confirmedAt, table.created_at)) return [];

  const paidCount = await getPaidTicketCountForOrder(orderId, client);
  if (paidCount <= 0) return [];

  const ticketNumbers = await getPaidTicketNumbersForOrder(orderId, client);
  const periodKey = periodKeyForTable(table, confirmedAt);
  const remainder = await getProgressRemainder(table.id, userId, periodKey, client);
  const { slots, newRemainder } = calculateSlotsToAward(table, paidCount, remainder);

  if (table.aggregation === "cumulative") {
    await setProgressRemainder(table.id, userId, periodKey, newRemainder, client);
  }

  return insertBonusEntries({
    table,
    userId,
    userPhone,
    orderId,
    slots,
    paidCount,
    ticketNumbers,
    client,
  });
}

export async function listBonusTablesForRaffle(raffleId: number): Promise<BonusTableDto[]> {
  const rows = await pgAll<RaffleBonusTableRow>(
    `SELECT * FROM raffle_bonus_tables WHERE raffle_id = ? ORDER BY start_at DESC, id DESC`,
    [raffleId],
  );
  const out: BonusTableDto[] = [];
  for (const row of rows) {
    const cnt = await pgGet<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM raffle_bonus_table_entries WHERE bonus_table_id = ?`,
      [row.id],
    );
    out.push(bonusTableToDto(row, Math.floor(Number(cnt?.c) || 0)));
  }
  return out;
}

export async function getBonusTableById(id: number): Promise<RaffleBonusTableRow | null> {
  return (await pgGet<RaffleBonusTableRow>(`SELECT * FROM raffle_bonus_tables WHERE id = ?`, [id])) ?? null;
}

export async function getBonusTableBySlug(slug: string): Promise<RaffleBonusTableRow | null> {
  const h = String(slug || "").trim();
  if (!h) return null;
  return (await pgGet<RaffleBonusTableRow>(`SELECT * FROM raffle_bonus_tables WHERE public_slug = ?`, [h])) ?? null;
}

export type CreateBonusTableInput = {
  raffleId: number;
  title: string;
  description?: string;
  accessMode?: BonusTableAccessMode;
  viewPrivacy?: BonusTableViewPrivacy;
  startAtLocal: string;
  endAtLocal: string;
  countFrom?: BonusTableCountFrom;
  ticketsRequired?: number;
  bonusSlotsPerReward?: number;
  aggregation?: BonusTableAggregation;
  periodScope?: BonusTablePeriodScope;
  status?: BonusTableStatus;
  createdByUserId?: number | null;
};

export async function createBonusTable(
  input: CreateBonusTableInput,
): Promise<{ ok: true; table: BonusTableDto } | { ok: false; error: string }> {
  const title = String(input.title || "").trim();
  if (!title) return { ok: false, error: "Укажите заголовок" };
  const startAt = parseSiteDateTimeLocalToUtcMs(input.startAtLocal);
  const endAt = parseSiteDateTimeLocalToUtcMs(input.endAtLocal);
  if (startAt == null) return { ok: false, error: "Некорректная дата начала" };
  if (endAt == null) return { ok: false, error: "Некорректная дата завершения" };
  if (endAt <= startAt) return { ok: false, error: "Дата завершения должна быть позже начала" };

  const ticketsRequired = Math.max(1, Math.min(100, Math.floor(Number(input.ticketsRequired) || 2)));
  const bonusSlots = Math.max(1, Math.min(20, Math.floor(Number(input.bonusSlotsPerReward) || 1)));
  const accessMode: BonusTableAccessMode = input.accessMode === "link" ? "link" : "closed";
  const viewPrivacy: BonusTableViewPrivacy =
    input.viewPrivacy === "all_auth" || input.viewPrivacy === "admins_only"
      ? input.viewPrivacy
      : "participants_admins";
  const countFrom: BonusTableCountFrom =
    input.countFrom === "include_prior_same_day" ? "include_prior_same_day" : "table_created";
  const aggregation: BonusTableAggregation = input.aggregation === "per_order" ? "per_order" : "cumulative";
  const periodScope: BonusTablePeriodScope = input.periodScope === "full_period" ? "full_period" : "same_day";
  const status: BonusTableStatus =
    input.status === "draft" || input.status === "ended" ? input.status : "active";

  let slug = generatePublicSlug();
  for (let i = 0; i < 5; i++) {
    const exists = await pgGet<{ id: number }>(`SELECT id FROM raffle_bonus_tables WHERE public_slug = ?`, [slug]);
    if (!exists) break;
    slug = generatePublicSlug();
  }

  const ts = nowMs();
  const inserted = await pgGet<{ id: number }>(
    `INSERT INTO raffle_bonus_tables (
      raffle_id, title, description, access_mode, view_privacy, public_slug,
      start_at, end_at, count_from, tickets_required, bonus_slots_per_reward,
      aggregation, period_scope, status, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      input.raffleId,
      title,
      String(input.description || "").trim().slice(0, 2000),
      accessMode,
      viewPrivacy,
      slug,
      startAt,
      endAt,
      countFrom,
      ticketsRequired,
      bonusSlots,
      aggregation,
      periodScope,
      status,
      input.createdByUserId ?? null,
      ts,
      ts,
    ],
  );
  const id = Math.floor(Number(inserted?.id) || 0);
  if (!id) return { ok: false, error: "Не удалось создать таблицу" };
  const row = await getBonusTableById(id);
  if (!row) return { ok: false, error: "Не удалось создать таблицу" };

  if (countFrom === "include_prior_same_day" && status === "active") {
    await backfillBonusTablePriorSameDay(id);
  }

  return { ok: true, table: bonusTableToDto(row, 0) };
}

export type UpdateBonusTableInput = Partial<{
  title: string;
  description: string;
  accessMode: BonusTableAccessMode;
  viewPrivacy: BonusTableViewPrivacy;
  startAtLocal: string;
  endAtLocal: string;
  countFrom: BonusTableCountFrom;
  ticketsRequired: number;
  bonusSlotsPerReward: number;
  aggregation: BonusTableAggregation;
  periodScope: BonusTablePeriodScope;
  status: BonusTableStatus;
}>;

export async function updateBonusTable(
  id: number,
  input: UpdateBonusTableInput,
): Promise<{ ok: true; table: BonusTableDto } | { ok: false; error: string }> {
  const row = await getBonusTableById(id);
  if (!row) return { ok: false, error: "Таблица не найдена" };

  const title = input.title !== undefined ? String(input.title).trim() : row.title;
  if (!title) return { ok: false, error: "Укажите заголовок" };

  let startAt = row.start_at;
  let endAt = row.end_at;
  if (input.startAtLocal !== undefined) {
    const v = parseSiteDateTimeLocalToUtcMs(input.startAtLocal);
    if (v == null) return { ok: false, error: "Некорректная дата начала" };
    startAt = v;
  }
  if (input.endAtLocal !== undefined) {
    const v = parseSiteDateTimeLocalToUtcMs(input.endAtLocal);
    if (v == null) return { ok: false, error: "Некорректная дата завершения" };
    endAt = v;
  }
  if (endAt <= startAt) return { ok: false, error: "Дата завершения должна быть позже начала" };

  const accessMode: BonusTableAccessMode =
    input.accessMode === "link" || input.accessMode === "closed" ? input.accessMode : row.access_mode;
  const viewPrivacy: BonusTableViewPrivacy =
    input.viewPrivacy === "all_auth" || input.viewPrivacy === "admins_only" || input.viewPrivacy === "participants_admins"
      ? input.viewPrivacy
      : row.view_privacy;
  const countFrom: BonusTableCountFrom =
    input.countFrom === "include_prior_same_day" || input.countFrom === "table_created"
      ? input.countFrom
      : row.count_from;
  const aggregation: BonusTableAggregation =
    input.aggregation === "per_order" || input.aggregation === "cumulative" ? input.aggregation : row.aggregation;
  const periodScope: BonusTablePeriodScope =
    input.periodScope === "full_period" || input.periodScope === "same_day" ? input.periodScope : row.period_scope;
  const status: BonusTableStatus =
    input.status === "draft" || input.status === "active" || input.status === "ended" ? input.status : row.status;
  const ticketsRequired =
    input.ticketsRequired !== undefined
      ? Math.max(1, Math.min(100, Math.floor(Number(input.ticketsRequired) || 1)))
      : row.tickets_required;
  const bonusSlots =
    input.bonusSlotsPerReward !== undefined
      ? Math.max(1, Math.min(20, Math.floor(Number(input.bonusSlotsPerReward) || 1)))
      : row.bonus_slots_per_reward;

  const ts = nowMs();
  await pgExec(
    `UPDATE raffle_bonus_tables SET
      title = ?, description = ?, access_mode = ?, view_privacy = ?,
      start_at = ?, end_at = ?, count_from = ?, tickets_required = ?,
      bonus_slots_per_reward = ?, aggregation = ?, period_scope = ?, status = ?, updated_at = ?
     WHERE id = ?`,
    [
      title,
      input.description !== undefined ? String(input.description).trim().slice(0, 2000) : row.description,
      accessMode,
      viewPrivacy,
      startAt,
      endAt,
      countFrom,
      ticketsRequired,
      bonusSlots,
      aggregation,
      periodScope,
      status,
      ts,
      id,
    ],
  );
  const updated = await getBonusTableById(id);
  if (!updated) return { ok: false, error: "Таблица не найдена" };
  const cnt = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM raffle_bonus_table_entries WHERE bonus_table_id = ?`,
    [id],
  );
  return { ok: true, table: bonusTableToDto(updated, Math.floor(Number(cnt?.c) || 0)) };
}

export async function deleteBonusTable(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await getBonusTableById(id);
  if (!row) return { ok: false, error: "Таблица не найдена" };
  await pgExec(`DELETE FROM raffle_bonus_tables WHERE id = ?`, [id]);
  return { ok: true };
}

export async function backfillBonusTablePriorSameDay(tableId: number): Promise<void> {
  const table = await getBonusTableById(tableId);
  if (!table || table.count_from !== "include_prior_same_day") return;

  const bounds = getSiteCalendarDayBoundsUtcMs(table.created_at);
  if (!bounds) return;

  const orders = await pgAll<{ id: number; user_id: number; updated_at: number }>(
    `SELECT o.id, o.user_id, o.updated_at
     FROM raffle_orders o
     WHERE o.raffle_id = ? AND o.status = 'confirmed'
       AND o.updated_at >= ? AND o.updated_at < ?
     ORDER BY o.updated_at ASC, o.id ASC`,
    [table.raffle_id, bounds.startMs, table.created_at],
  );

  for (const order of orders) {
    const user = await getUserById(order.user_id);
    if (!user) continue;
    await processOrderForTable(table, order.id, order.user_id, user.phone, order.updated_at);
  }
}

export async function processBonusTablesForConfirmedOrder(
  orderId: number,
  confirmedAt = Date.now(),
): Promise<BonusTableAwardResult[]> {
  const order = await pgGet<{ id: number; raffle_id: number; user_id: number; status: string }>(
    `SELECT id, raffle_id, user_id, status FROM raffle_orders WHERE id = ?`,
    [orderId],
  );
  if (!order || order.status !== "confirmed") return [];

  const user = await getUserById(order.user_id);
  if (!user) return [];

  const tables = await pgAll<RaffleBonusTableRow>(
    `SELECT * FROM raffle_bonus_tables
     WHERE raffle_id = ? AND status = 'active'
       AND start_at <= ? AND end_at >= ?
     ORDER BY id ASC`,
    [order.raffle_id, confirmedAt, confirmedAt],
  );

  const awards: BonusTableAwardResult[] = [];
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    for (const table of tables) {
      const positions = await processOrderForTable(
        table,
        order.id,
        order.user_id,
        user.phone,
        confirmedAt,
        client,
      );
      if (positions.length) {
        awards.push({
          table_id: table.id,
          table_title: table.title,
          public_slug: table.public_slug,
          positions,
        });
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
  return awards;
}

export function buildBonusTableChatCardPayload(input: {
  tableTitle: string;
  publicSlug: string;
  positions: number[];
}): string {
  const payload = {
    kind: "bonus_table",
    title: "Бонусная таблица",
    subtitle: input.tableTitle,
    table_slug: input.publicSlug,
    positions: input.positions,
    open_url: `/home/bonus-table/${encodeURIComponent(input.publicSlug)}`,
    cta: "Открыть бонусную таблицу",
  };
  return `[[AB_CARD:${encodeURIComponent(JSON.stringify(payload))}]]`;
}

export function buildBonusTableManualChatBody(
  tableTitle: string,
  publicSlug: string,
  positions: number[],
): string {
  const safeTitle = String(tableTitle || "Бонусная таблица").trim() || "Бонусная таблица";
  const posHuman = positions.map((p) => `#${p}`).join(", ");
  const lines = [
    `🎁 Вас добавили в бонусную таблицу «${safeTitle}».`,
    `Ваше место: ${posHuman}.`,
    "",
    "Нажмите кнопку ниже, чтобы открыть список.",
  ];
  const card = buildBonusTableChatCardPayload({
    tableTitle: safeTitle,
    publicSlug,
    positions,
  });
  return lines.join("\n") + "\n\n" + card;
}

export async function addManualBonusTableEntry(input: {
  tableId: number;
  phone: string;
  slots?: number;
  sendChat?: boolean;
}): Promise<
  | { ok: true; positions: number[]; user_id: number; table: BonusTableDto; message_id?: number }
  | { ok: false; error: string }
> {
  const table = await getBonusTableById(input.tableId);
  if (!table) return { ok: false, error: "Таблица не найдена" };

  const phone = normalizePhone(String(input.phone || ""));
  if (!phone || !isValidRuMobile(phone)) {
    return { ok: false, error: "Некорректный мобильный номер РФ" };
  }

  const user = await getUserByPhone(phone);
  if (!user) return { ok: false, error: "Пользователь с таким телефоном не найден" };

  const slots = Math.max(1, Math.min(20, Math.floor(Number(input.slots) || 1)));
  const positions = await insertBonusEntries({
    table,
    userId: user.id,
    userPhone: user.phone,
    orderId: null,
    slots,
    paidCount: 0,
    ticketNumbers: [],
  });
  if (!positions.length) return { ok: false, error: "Не удалось добавить запись" };

  const cnt = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM raffle_bonus_table_entries WHERE bonus_table_id = ?`,
    [table.id],
  );

  let messageId: number | undefined;
  if (input.sendChat !== false) {
    const body = buildBonusTableManualChatBody(table.title, table.public_slug, positions);
    messageId = await insertSupportMessage(user.id, body, true, null);
  }

  return {
    ok: true,
    positions,
    user_id: user.id,
    table: bonusTableToDto(table, Math.floor(Number(cnt?.c) || 0)),
    message_id: messageId,
  };
}

export function buildBonusTableAwardChatAppendix(awards: BonusTableAwardResult[]): string {
  if (!awards.length) return "";
  const lines: string[] = ["", "🎁 Вы попали в бонусную таблицу!"];
  for (const a of awards) {
    const posHuman = a.positions.map((p) => `#${p}`).join(", ");
    lines.push(`«${a.table_title}» — место ${posHuman}.`);
  }
  lines.push("", "Нажмите кнопку ниже, чтобы открыть список.");
  const cards = awards.map((a) =>
    buildBonusTableChatCardPayload({
      tableTitle: a.table_title,
      publicSlug: a.public_slug,
      positions: a.positions,
    }),
  );
  return lines.join("\n") + "\n\n" + cards.join("\n");
}

export async function userCanViewBonusTable(
  table: RaffleBonusTableRow,
  userId: number,
  userRole: string | null | undefined,
): Promise<boolean> {
  if (isStaffRole(userRole)) return true;
  if (table.access_mode === "closed" && table.view_privacy === "admins_only") return false;
  if (table.view_privacy === "all_auth") return true;
  if (table.view_privacy === "admins_only") return false;
  const entry = await pgGet<{ id: number }>(
    `SELECT id FROM raffle_bonus_table_entries WHERE bonus_table_id = ? AND user_id = ? LIMIT 1`,
    [table.id, userId],
  );
  return !!entry;
}

export async function getBonusTableViewForUser(
  slug: string,
  userId: number,
  userRole: string | null | undefined,
): Promise<
  | {
      ok: true;
      table: BonusTableDto;
      entries: BonusTableEntryDto[];
      my_positions: number[];
      raffle_title: string;
    }
  | { ok: false; error: string; status: number }
> {
  const table = await getBonusTableBySlug(slug);
  if (!table) return { ok: false, error: "Таблица не найдена", status: 404 };

  const canView = await userCanViewBonusTable(table, userId, userRole);
  if (!canView) return { ok: false, error: "Нет доступа к этой бонусной таблице", status: 403 };

  const raffle = await pgGet<{ title: string }>(`SELECT title FROM raffles WHERE id = ?`, [table.raffle_id]);
  const entryRows = await pgAll<RaffleBonusTableEntryRow>(
    `SELECT * FROM raffle_bonus_table_entries WHERE bonus_table_id = ? ORDER BY position ASC`,
    [table.id],
  );
  const cnt = entryRows.length;
  const entries: BonusTableEntryDto[] = entryRows.map((e) => ({
    position: e.position,
    phone: e.user_phone,
    is_mine: e.user_id === userId,
    created_at: e.created_at,
  }));
  const my_positions = entries.filter((e) => e.is_mine).map((e) => e.position);

  return {
    ok: true,
    table: bonusTableToDto(table, cnt),
    entries,
    my_positions,
    raffle_title: String(raffle?.title || "Акция"),
  };
}

export function formatBonusTablePeriodLabel(table: RaffleBonusTableRow): string {
  return `${formatRuSiteDateTime(table.start_at)} — ${formatRuSiteDateTime(table.end_at)} (${SITE_TIMEZONE_LABEL})`;
}
