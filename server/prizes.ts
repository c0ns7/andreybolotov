import { getUserById, insertSupportMessage, messageToDto } from "./db.js";
import { pgAll, pgExec, pgGet } from "./pg-sql.js";

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
};

export type PrizeClaimDataPhysical = {
  recipient_name: string;
  address: string;
  comment?: string;
};

export type PrizeClaimDataMoney = {
  phone: string;
  bank: string;
  recipient_name: string;
  comment?: string;
};

function nowMs() {
  return Date.now();
}

export function prizeAwardToDto(row: PrizeAwardRow, user?: { name: string; phone: string }) {
  let claim: Record<string, unknown> | null = null;
  if (row.claim_data) {
    try {
      claim = JSON.parse(row.claim_data) as Record<string, unknown>;
    } catch {
      claim = null;
    }
  }
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
  };
}

export function buildPrizeClaimChatBody(
  prizeId: number,
  title: string,
  prizeType: PrizeType,
  intro?: string,
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
}): Promise<{ ok: true; prize: PrizeAwardRow; messageId?: number } | { ok: false; error: string }> {
  const user = await getUserById(input.userId);
  if (!user) return { ok: false, error: "Пользователь не найден" };
  const title = String(input.title || "").trim();
  if (!title) return { ok: false, error: "Укажите название приза" };
  const prizeType = input.prizeType === "money" ? "money" : "physical";
  const ts = nowMs();
  const inserted = await pgGet<{ id: number }>(
    `INSERT INTO prize_awards (
      user_id, title, description, prize_type, status, claim_data, admin_notes,
      created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', '', '', ?, ?, ?) RETURNING id`,
    [input.userId, title, String(input.description || "").trim(), prizeType, input.createdByUserId, ts, ts],
  );
  const id = Number(inserted?.id || 0);
  if (!id) return { ok: false, error: "Не удалось создать приз" };
  const row = await pgGet<PrizeAwardRow>(`SELECT * FROM prize_awards WHERE id = ?`, [id]);
  if (!row) return { ok: false, error: "Не удалось создать приз" };

  let messageId: number | undefined;
  if (input.sendChat !== false) {
    const body = buildPrizeClaimChatBody(row.id, title, prizeType, input.introMessage);
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
  data: PrizeClaimDataPhysical | PrizeClaimDataMoney,
): Promise<{ ok: true; prize: PrizeAwardRow } | { ok: false; error: string }> {
  const row = await getPrizeAwardForUser(id, userId);
  if (!row) return { ok: false, error: "Приз не найден" };
  if (row.status === "done" || row.status === "cancelled") {
    return { ok: false, error: "Этот приз уже обработан" };
  }
  if (row.claimed_at) {
    return { ok: false, error: "Данные уже отправлены. Если нужно изменить — напишите в поддержку." };
  }

  if (row.prize_type === "physical") {
    const d = data as PrizeClaimDataPhysical;
    const address = String(d.address || "").trim();
    const recipient_name = String(d.recipient_name || "").trim();
    if (!address || address.length < 10) return { ok: false, error: "Укажите полный адрес доставки" };
    if (!recipient_name) return { ok: false, error: "Укажите имя получателя" };
    data = { recipient_name, address, comment: String(d.comment || "").trim().slice(0, 500) };
  } else {
    const d = data as PrizeClaimDataMoney;
    const phone = String(d.phone || "").replace(/\D/g, "");
    const bank = String(d.bank || "").trim();
    const recipient_name = String(d.recipient_name || "").trim();
    if (phone.length < 10) return { ok: false, error: "Укажите корректный телефон" };
    if (!bank) return { ok: false, error: "Укажите банк" };
    if (!recipient_name) return { ok: false, error: "Укажите получателя" };
    data = {
      phone,
      bank,
      recipient_name,
      comment: String(d.comment || "").trim().slice(0, 500),
    };
  }

  const ts = nowMs();
  await pgExec(
    `UPDATE prize_awards SET status = 'claimed', claim_data = ?, claimed_at = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(data), ts, ts, id],
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
