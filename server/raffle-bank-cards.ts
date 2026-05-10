import type { PoolClient } from "pg";
import { pgPool } from "./pg.js";
import { pgAll, pgExec, pgGet } from "./pg-sql.js";

export type RaffleBankCardRow = {
  id: number;
  raffle_id: number;
  sort_order: number;
  card_number: string;
  recipient: string;
  /** 0 = без дневного лимита */
  daily_max_orders: number;
  disabled_until_ms: number | null;
  created_at: number;
  updated_at: number;
};

export type RaffleBankCardInput = {
  id?: number;
  card_number: string;
  recipient: string;
  daily_max_orders: number;
  disabled_until_ms: number | null;
  sort_order: number;
};

export type RaffleBankCardAdminDto = RaffleBankCardRow & {
  stats_tickets_confirmed: number;
  stats_amount_rub_confirmed: number;
  usages_today_msk: number;
};

export async function publicRaffleExtraFields(raffleId: number): Promise<{ has_bank_cards: boolean }> {
  return { has_bank_cards: await raffleHasAnyBankCards(raffleId) };
}

export async function raffleHasAnyBankCards(raffleId: number): Promise<boolean> {
  const row = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM raffle_bank_cards WHERE raffle_id = ?`,
    [raffleId],
  );
  return Math.floor(Number(row?.c ?? 0)) > 0;
}

export async function listBankCardsWithAdminStats(raffleId: number, nowMs: number): Promise<RaffleBankCardAdminDto[]> {
  const cards = await pgAll<RaffleBankCardRow>(
    `SELECT * FROM raffle_bank_cards WHERE raffle_id = ? ORDER BY sort_order ASC, id ASC`,
    [raffleId],
  );
  if (!cards.length) return [];
  const statsRows = await pgAll<{ bank_card_id: number; tickets: number; amount: number }>(
    `SELECT bank_card_id AS bank_card_id,
            COALESCE(SUM(ticket_count), 0)::int AS tickets,
            COALESCE(SUM(amount_rub), 0)::bigint AS amount
       FROM raffle_orders
      WHERE raffle_id = ? AND bank_card_id IS NOT NULL AND status = 'confirmed'
      GROUP BY bank_card_id`,
    [raffleId],
  );
  const statMap = new Map<number, { tickets: number; amount: number }>();
  for (const s of statsRows) {
    statMap.set(s.bank_card_id, { tickets: s.tickets, amount: Number(s.amount) || 0 });
  }
  const out: RaffleBankCardAdminDto[] = [];
  for (const c of cards) {
    const st = statMap.get(c.id) ?? { tickets: 0, amount: 0 };
    const usages_today_msk = await countCardUsageTodayMsk(c.id, nowMs);
    out.push({
      ...c,
      stats_tickets_confirmed: st.tickets,
      stats_amount_rub_confirmed: st.amount,
      usages_today_msk,
    });
  }
  return out;
}

export async function countCardUsageTodayMsk(cardId: number, nowMs: number): Promise<number> {
  const row = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c
       FROM raffle_orders o
      WHERE o.bank_card_id = ?
        AND o.status IN ('pending_review', 'confirmed')
        AND (to_timestamp(o.created_at / 1000.0) AT TIME ZONE 'Europe/Moscow')::date =
            (to_timestamp(?::bigint / 1000.0) AT TIME ZONE 'Europe/Moscow')::date`,
    [cardId, nowMs],
  );
  return Math.max(0, Math.floor(Number(row?.c ?? 0)));
}

function isCardTemporarilyDisabled(row: RaffleBankCardRow, nowMs: number): boolean {
  const du = row.disabled_until_ms;
  return du != null && Number.isFinite(du) && du > nowMs;
}

export async function isBankCardAvailableForNewPayment(
  row: RaffleBankCardRow,
  nowMs: number,
): Promise<{ ok: true } | { ok: false }> {
  if (isCardTemporarilyDisabled(row, nowMs)) return { ok: false };
  const maxN = Math.max(0, Math.floor(Number(row.daily_max_orders) || 0));
  if (maxN <= 0) return { ok: true };
  const used = await countCardUsageTodayMsk(row.id, nowMs);
  return used < maxN ? { ok: true } : { ok: false };
}

export type PickBankCardArgs = {
  raffleId: number;
  nowMs: number;
  orderTicketCount: number;
  cardPaymentScope: string;
  wholesaleEveryN: number;
};

export async function pickAvailableBankCard(args: PickBankCardArgs): Promise<RaffleBankCardRow | null> {
  const scope = String(args.cardPaymentScope || "unlimited").toLowerCase();
  const everyN = Math.max(1, Math.floor(Number(args.wholesaleEveryN) || 10));
  const tickets = Math.max(0, Math.floor(Number(args.orderTicketCount) || 0));
  if (scope === "wholesale_only" && tickets < everyN) return null;

  const rows = await pgAll<RaffleBankCardRow>(
    `SELECT * FROM raffle_bank_cards WHERE raffle_id = ? ORDER BY sort_order ASC, id ASC`,
    [args.raffleId],
  );
  for (const row of rows) {
    const av = await isBankCardAvailableForNewPayment(row, args.nowMs);
    if (av.ok) return row;
  }
  return null;
}

export async function getBankCardByIdForRaffle(
  cardId: number,
  raffleId: number,
  client?: PoolClient,
): Promise<RaffleBankCardRow | undefined> {
  return pgGet<RaffleBankCardRow>(
    `SELECT * FROM raffle_bank_cards WHERE id = ? AND raffle_id = ?`,
    [cardId, raffleId],
    client,
  );
}

/** После перевода заявки с картой в pending_review — при превышении дневного лимита отключаем карту на сутки. */
export async function refreshBankCardDailyLimitCooldown(bankCardId: number | null | undefined, nowMs: number): Promise<void> {
  const id = Math.floor(Number(bankCardId) || 0);
  if (!id) return;
  const row = await pgGet<RaffleBankCardRow>(`SELECT * FROM raffle_bank_cards WHERE id = ?`, [id]);
  if (!row) return;
  const maxN = Math.max(0, Math.floor(Number(row.daily_max_orders) || 0));
  if (maxN <= 0) return;
  const used = await countCardUsageTodayMsk(id, nowMs);
  if (used >= maxN) {
    const until = nowMs + 24 * 60 * 60 * 1000;
    await pgExec(`UPDATE raffle_bank_cards SET disabled_until_ms = ?, updated_at = ? WHERE id = ?`, [until, nowMs, id]);
  }
}

export async function replaceRaffleBankCards(raffleId: number, cards: RaffleBankCardInput[]): Promise<void> {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const now = Date.now();
    const existing = await pgAll<{ id: number }>(
      `SELECT id FROM raffle_bank_cards WHERE raffle_id = ?`,
      [raffleId],
      client,
    );
    const existingSet = new Set(existing.map((e) => e.id));
    const kept = new Set<number>();
    let ord = 0;
    for (const c of cards) {
      const cardNumber = String(c.card_number || "").trim();
      const recipient = String(c.recipient || "").trim();
      if (!cardNumber && !recipient) continue;
      if (!cardNumber) continue;
      const daily = Math.max(0, Math.floor(Number(c.daily_max_orders) || 0));
      const du = c.disabled_until_ms;
      const disabled =
        du == null || du === 0 || !Number.isFinite(Number(du)) ? null : Math.floor(Number(du));
      const cid = c.id && existingSet.has(c.id) ? c.id : undefined;
      if (cid) {
        await pgExec(
          `UPDATE raffle_bank_cards
              SET card_number = ?, recipient = ?, daily_max_orders = ?, disabled_until_ms = ?, sort_order = ?, updated_at = ?
            WHERE id = ? AND raffle_id = ?`,
          [cardNumber, recipient, daily, disabled, ord, now, cid, raffleId],
          client,
        );
        kept.add(cid);
      } else {
        const ins = await pgGet<{ id: number }>(
          `INSERT INTO raffle_bank_cards (
             raffle_id, sort_order, card_number, recipient, daily_max_orders, disabled_until_ms, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          [raffleId, ord, cardNumber, recipient, daily, disabled, now, now],
          client,
        );
        const newId = Math.floor(Number(ins?.id) || 0);
        if (newId) kept.add(newId);
      }
      ord += 1;
    }
    for (const e of existing) {
      if (!kept.has(e.id)) {
        await pgExec(`DELETE FROM raffle_bank_cards WHERE id = ? AND raffle_id = ?`, [e.id, raffleId], client);
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
}
