import { getRaffleById, getUserById, insertSupportMessage, messageToDto } from "./db.js";
import { pgAll, pgExec, pgGet } from "./pg-sql.js";
import {
  adminAssignRandomTicketsToPhone,
  notifyUserTicketAssignment,
} from "./raffle-orders.js";

export type PrizeType = "physical" | "money";
export type PrizeStatus = "pending" | "claimed" | "processing" | "done" | "cancelled";

export type PrizeAwardRow = {
  id: number;
  user_id: number;
  title: string;
  description: string;
  prize_type: PrizeType;
  status: PrizeStatus;
  claim_data: string;
  admin_notes: string;
  created_by_user_id: number | null;
  created_at: number;
  updated_at: number;
  claimed_at: number | null;
  admin_marked_done_at: number | null;
  transfer_receipt_url: string;
  transfer_receipt_name: string;
  transfer_receipt_mime: string;
  review_requested: number;
  review_received: number;
  chat_message_id: number | null;
  raffle_id: number | null;
  money_amount_rub: number;
  exchange_ticket_count: number;
  allows_ticket_exchange: number;
};

export type PrizeClaimDataPhysical = {
  recipient_name: string;
  address: string;
  comment?: string;
};

export type PrizeClaimDataMoneyCash = {
  choice: "money";
  phone: string;
  bank: string;
  recipient_name: string;
  comment?: string;
};

export type PrizeClaimDataMoneyTickets = {
  choice: "tickets";
  comment?: string;
};

export type PrizeClaimDataMoney = PrizeClaimDataMoneyCash | PrizeClaimDataMoneyTickets;

function nowMs() {
  return Date.now();
}

function parseClaimData(row: PrizeAwardRow): Record<string, unknown> | null {
  if (!row.claim_data) return null;
  try {
    return JSON.parse(row.claim_data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function prizeAwardToDto(
  row: PrizeAwardRow,
  user?: { name: string; phone: string },
  extra?: { raffle_title?: string },
) {
  const claim = parseClaimData(row);
  return {
    id: row.id,
    user_id: row.user_id,
    user_name: user?.name ?? "",
    user_phone: user?.phone ?? "",
    title: row.title,
    description: row.description,
    prize_type: row.prize_type,
    status: row.status,
    claim_data: claim,
    admin_notes: row.admin_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    claimed_at: row.claimed_at,
    admin_marked_done_at: row.admin_marked_done_at,
    transfer_receipt_url: row.transfer_receipt_url || null,
    transfer_receipt_name: row.transfer_receipt_name || null,
    transfer_receipt_mime: row.transfer_receipt_mime || null,
    review_requested: !!row.review_requested,
    review_received: !!row.review_received,
    chat_message_id: row.chat_message_id,
    money_amount_rub: Math.max(0, Math.floor(Number(row.money_amount_rub) || 0)),
    allows_ticket_exchange: !!row.allows_ticket_exchange,
    raffle_id: row.raffle_id ? Number(row.raffle_id) : null,
    exchange_ticket_count: Math.max(0, Math.floor(Number(row.exchange_ticket_count) || 0)),
    raffle_title: extra?.raffle_title ?? "",
  };
}

export async function prizeAwardToDtoAsync(row: PrizeAwardRow, user?: { name: string; phone: string }) {
  let raffle_title = "";
  if (row.raffle_id) {
    const raffle = await getRaffleById(row.raffle_id);
    raffle_title = raffle?.title ?? "";
  }
  return prizeAwardToDto(row, user, { raffle_title });
}

export function buildPrizeClaimChatBody(
  prizeId: number,
  title: string,
  prizeType: PrizeType,
  intro?: string,
  opts?: {
    moneyAmountRub?: number;
    allowsTicketExchange?: boolean;
    exchangeTicketCount?: number;
  },
): string {
  const safeTitle = String(title || "Приз").trim() || "Приз";
  const lines: string[] = [];
  if (intro && String(intro).trim()) {
    lines.push(String(intro).trim());
    lines.push("");
  }
  lines.push("🎉 Поздравляем! Вы выиграли приз в акции.");
  lines.push(`Приз: «${safeTitle}».`);
  lines.push("");
  if (prizeType === "physical") {
    lines.push("Нажмите кнопку ниже и укажите адрес доставки — так мы не пропустим ваш ответ среди других сообщений.");
  } else if (opts?.allowsTicketExchange && (opts.exchangeTicketCount ?? 0) > 0) {
    const amount =
      opts.moneyAmountRub && opts.moneyAmountRub > 0
        ? ` (${opts.moneyAmountRub.toLocaleString("ru-RU")} ₽)`
        : "";
    lines.push(
      `Нажмите кнопку ниже: вы можете получить денежный приз${amount} или обменять его на ${opts.exchangeTicketCount} номерков в акции.`,
    );
  } else {
    lines.push(
      "Нажмите кнопку ниже и укажите телефон, банк и получателя для перевода — так мы не пропустим ваш ответ среди других сообщений.",
    );
  }
  const payload = {
    kind: "prize_claim",
    title: "Забрать приз",
    subtitle: safeTitle,
    prize_id: prizeId,
    prize_type: prizeType,
    cta: "Забрать приз",
    claim_url: `/home/prize/${prizeId}`,
  };
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return lines.join("\n") + `\n\n[[AB_CARD:${encoded}]]`;
}

export async function createPrizeAward(input: {
  userId: number;
  title: string;
  description?: string;
  prizeType: PrizeType;
  createdByUserId: number | null;
  introMessage?: string;
  sendChat?: boolean;
  moneyAmountRub?: number;
  allowsTicketExchange?: boolean;
  raffleId?: number | null;
  exchangeTicketCount?: number;
}): Promise<{ ok: true; prize: PrizeAwardRow; messageId?: number } | { ok: false; error: string }> {
  const user = await getUserById(input.userId);
  if (!user) return { ok: false, error: "Пользователь не найден" };
  const title = String(input.title || "").trim();
  if (!title) return { ok: false, error: "Укажите название приза" };
  const prizeType = input.prizeType === "money" ? "money" : "physical";
  const allowsExchange = prizeType === "money" && !!input.allowsTicketExchange;
  const exchangeCount = Math.max(0, Math.floor(Number(input.exchangeTicketCount) || 0));
  const raffleId =
    input.raffleId != null && Number.isFinite(Number(input.raffleId)) ? Math.floor(Number(input.raffleId)) : null;
  const moneyAmountRub = Math.max(0, Math.floor(Number(input.moneyAmountRub) || 0));

  if (allowsExchange) {
    if (!raffleId) return { ok: false, error: "Выберите акцию для обмена на номерки" };
    if (exchangeCount < 1) return { ok: false, error: "Укажите количество номерков при обмене" };
    const raffle = await getRaffleById(raffleId);
    if (!raffle) return { ok: false, error: "Акция не найдена" };
  }

  const ts = nowMs();
  const inserted = await pgGet<{ id: number }>(
    `INSERT INTO prize_awards (
      user_id, title, description, prize_type, status, claim_data, admin_notes,
      created_by_user_id, created_at, updated_at,
      raffle_id, money_amount_rub, exchange_ticket_count, allows_ticket_exchange
    ) VALUES (?, ?, ?, ?, 'pending', '', '', ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      input.userId,
      title,
      String(input.description || "").trim(),
      prizeType,
      input.createdByUserId,
      ts,
      ts,
      allowsExchange ? raffleId : null,
      moneyAmountRub,
      allowsExchange ? exchangeCount : 0,
      allowsExchange ? 1 : 0,
    ],
  );
  const id = Number(inserted?.id || 0);
  if (!id) return { ok: false, error: "Не удалось создать приз" };
  const row = await pgGet<PrizeAwardRow>(`SELECT * FROM prize_awards WHERE id = ?`, [id]);
  if (!row) return { ok: false, error: "Не удалось создать приз" };

  let messageId: number | undefined;
  if (input.sendChat !== false) {
    const body = buildPrizeClaimChatBody(row.id, title, prizeType, input.introMessage, {
      moneyAmountRub,
      allowsTicketExchange: allowsExchange,
      exchangeTicketCount: exchangeCount,
    });
    messageId = await insertSupportMessage(input.userId, body, true, null);
    await pgExec(`UPDATE prize_awards SET chat_message_id = ? WHERE id = ?`, [messageId, row.id]);
    row.chat_message_id = messageId;
  }
  return { ok: true, prize: row, messageId };
}

export async function listPrizeAwardsForAdmin(opts: {
  status?: string;
  q?: string;
  offset?: number;
  limit?: number;
}): Promise<{ prizes: PrizeAwardRow[]; users: Map<number, { name: string; phone: string }>; total: number }> {
  const offset = Math.max(0, Math.floor(Number(opts.offset ?? 0)));
  const limit = Math.min(80, Math.max(1, Math.floor(Number(opts.limit ?? 40))));
  const q = String(opts.q ?? "").trim().toLowerCase();
  const status = String(opts.status ?? "").trim();

  const where: string[] = ["1=1"];
  const params: unknown[] = [];
  if (status && status !== "all") {
    where.push("p.status = ?");
    params.push(status);
  }
  if (q) {
    where.push(
      `(LOWER(p.title) LIKE ? OR LOWER(u.name) LIKE ? OR u.phone LIKE ? OR CAST(p.id AS TEXT) = ?)`,
    );
    const like = `%${q}%`;
    params.push(like, like, `%${q.replace(/\D/g, "")}%`, q.replace(/\D/g, "") || q);
  }

  const whereSql = where.join(" AND ");
  const countRow = await pgGet<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM prize_awards p
     INNER JOIN users u ON u.id = p.user_id
     WHERE ${whereSql}`,
    params,
  );
  const total = countRow?.c ?? 0;

  const rows = await pgAll<PrizeAwardRow & { user_name: string; user_phone: string }>(
    `SELECT p.*, u.name AS user_name, u.phone AS user_phone
     FROM prize_awards p
     INNER JOIN users u ON u.id = p.user_id
     WHERE ${whereSql}
     ORDER BY
       CASE p.status
         WHEN 'claimed' THEN 0
         WHEN 'processing' THEN 1
         WHEN 'pending' THEN 2
         WHEN 'done' THEN 3
         ELSE 4
       END,
       COALESCE(p.claimed_at, p.created_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const users = new Map<number, { name: string; phone: string }>();
  const prizes: PrizeAwardRow[] = [];
  for (const r of rows) {
    users.set(r.user_id, { name: r.user_name, phone: r.user_phone });
    prizes.push(r);
  }
  return { prizes, users, total };
}

export async function getPrizeAwardById(id: number): Promise<PrizeAwardRow | null> {
  return (await pgGet<PrizeAwardRow>(`SELECT * FROM prize_awards WHERE id = ?`, [id])) ?? null;
}

export async function getPrizeAwardForUser(id: number, userId: number): Promise<PrizeAwardRow | null> {
  return (await pgGet<PrizeAwardRow>(`SELECT * FROM prize_awards WHERE id = ? AND user_id = ?`, [id, userId])) ?? null;
}

export async function submitPrizeClaim(
  id: number,
  userId: number,
  data: PrizeClaimDataPhysical | PrizeClaimDataMoney | Record<string, unknown>,
): Promise<{ ok: true; prize: PrizeAwardRow } | { ok: false; error: string }> {
  const row = await getPrizeAwardForUser(id, userId);
  if (!row) return { ok: false, error: "Приз не найден" };
  if (row.status === "done" || row.status === "cancelled") {
    return { ok: false, error: "Этот приз уже обработан" };
  }
  if (row.claimed_at) {
    return { ok: false, error: "Данные уже отправлены. Если нужно изменить — напишите в поддержку." };
  }

  const ts = nowMs();
  let claimPayload: Record<string, unknown>;
  let status: PrizeStatus = "claimed";

  if (row.prize_type === "physical") {
    const d = data as PrizeClaimDataPhysical;
    const address = String(d.address || "").trim();
    const recipient_name = String(d.recipient_name || "").trim();
    if (!address || address.length < 10) return { ok: false, error: "Укажите полный адрес доставки" };
    if (!recipient_name) return { ok: false, error: "Укажите имя получателя" };
    claimPayload = { recipient_name, address, comment: String(d.comment || "").trim().slice(0, 500) };
  } else {
    const choice = String((data as Record<string, unknown>).choice || "money").trim();
    if (choice === "tickets") {
      if (!row.allows_ticket_exchange) {
        return { ok: false, error: "Обмен на номерки для этого приза недоступен" };
      }
      if (!row.raffle_id) return { ok: false, error: "Акция для номерков не настроена" };
      const count = Math.max(1, Math.floor(Number(row.exchange_ticket_count) || 1));
      const user = await getUserById(userId);
      if (!user?.phone) {
        return { ok: false, error: "Укажите телефон в профиле или выберите получение деньгами" };
      }
      const assign = await adminAssignRandomTicketsToPhone(row.raffle_id, user.phone, count);
      if (!assign.ok) return { ok: false, error: assign.error };
      const raffle = await getRaffleById(row.raffle_id);
      await notifyUserTicketAssignment(
        userId,
        raffle?.title ?? "акция",
        assign.ticket_numbers,
        `Номерки закреплены по обмену денежного приза «${row.title}».`,
      );
      claimPayload = {
        choice: "tickets",
        ticket_numbers: assign.ticket_numbers,
        raffle_id: row.raffle_id,
        comment: String((data as Record<string, unknown>).comment || "")
          .trim()
          .slice(0, 500),
      };
      status = "done";
    } else {
      const d = data as PrizeClaimDataMoneyCash;
      const phone = String(d.phone || "").replace(/\D/g, "");
      const bank = String(d.bank || "").trim();
      const recipient_name = String(d.recipient_name || "").trim();
      if (phone.length < 10) return { ok: false, error: "Укажите корректный телефон" };
      if (!bank) return { ok: false, error: "Укажите банк" };
      if (!recipient_name) return { ok: false, error: "Укажите получателя" };
      claimPayload = {
        choice: "money",
        phone,
        bank,
        recipient_name,
        comment: String(d.comment || "").trim().slice(0, 500),
      };
    }
  }

  await pgExec(
    `UPDATE prize_awards SET status = ?, claim_data = ?, claimed_at = ?, updated_at = ? WHERE id = ?`,
    [status, JSON.stringify(claimPayload), ts, ts, id],
  );
  const updated = await getPrizeAwardById(id);
  if (!updated) return { ok: false, error: "Ошибка сохранения" };
  return { ok: true, prize: updated };
}

export async function updatePrizeAwardAdmin(
  id: number,
  patch: {
    status?: PrizeStatus;
    admin_notes?: string;
    transfer_receipt_url?: string;
    transfer_receipt_name?: string;
    transfer_receipt_mime?: string;
    review_requested?: boolean;
    review_received?: boolean;
    mark_done?: boolean;
  },
): Promise<{ ok: true; prize: PrizeAwardRow } | { ok: false; error: string }> {
  const row = await getPrizeAwardById(id);
  if (!row) return { ok: false, error: "Приз не найден" };

  const ts = nowMs();
  const status = patch.status ?? row.status;
  let admin_marked_done_at = row.admin_marked_done_at;
  if (patch.mark_done) {
    admin_marked_done_at = ts;
  }
  const finalStatus: PrizeStatus = patch.mark_done ? "done" : status;

  await pgExec(
    `UPDATE prize_awards SET
      status = ?,
      admin_notes = ?,
      transfer_receipt_url = ?,
      transfer_receipt_name = ?,
      transfer_receipt_mime = ?,
      review_requested = ?,
      review_received = ?,
      admin_marked_done_at = ?,
      updated_at = ?
     WHERE id = ?`,
    [
      finalStatus,
      patch.admin_notes !== undefined ? String(patch.admin_notes) : row.admin_notes,
      patch.transfer_receipt_url !== undefined ? patch.transfer_receipt_url : row.transfer_receipt_url,
      patch.transfer_receipt_name !== undefined ? patch.transfer_receipt_name : row.transfer_receipt_name,
      patch.transfer_receipt_mime !== undefined ? patch.transfer_receipt_mime : row.transfer_receipt_mime,
      patch.review_requested !== undefined ? (patch.review_requested ? 1 : 0) : row.review_requested,
      patch.review_received !== undefined ? (patch.review_received ? 1 : 0) : row.review_received,
      admin_marked_done_at,
      ts,
      id,
    ],
  );

  const updated = await getPrizeAwardById(id);
  if (!updated) return { ok: false, error: "Ошибка сохранения" };
  return { ok: true, prize: updated };
}

export async function sendPrizeReceiptToUserChat(
  prizeId: number,
  adminUserId: number,
): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
  const row = await getPrizeAwardById(prizeId);
  if (!row) return { ok: false, error: "Приз не найден" };
  if (row.prize_type !== "money") return { ok: false, error: "Чек можно отправить только для денежного приза" };
  const claim = parseClaimData(row);
  if (claim?.choice === "tickets") {
    return { ok: false, error: "Пользователь выбрал обмен на номерки — чек перевода не нужен" };
  }
  if (!row.transfer_receipt_url) return { ok: false, error: "Сначала загрузите чек перевода" };

  const body =
    `✅ Перевод по призу «${row.title}» выполнен.\n` +
    `Пожалуйста, оставьте отзыв о получении приза в нашем приватном чате в MAX — это очень помогает проекту.\n\n` +
    `Чек перевода прикреплён к этому сообщению в разделе призов (админ).`;
  const messageId = await insertSupportMessage(row.user_id, body, true, {
    url: row.transfer_receipt_url,
    name: row.transfer_receipt_name || "Чек перевода.pdf",
    mime: row.transfer_receipt_mime || "application/pdf",
  });
  await pgExec(`UPDATE prize_awards SET review_requested = 1, updated_at = ? WHERE id = ?`, [nowMs(), prizeId]);
  return { ok: true, messageId };
}

export { messageToDto };
