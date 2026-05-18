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
  raffle_id: number | null;
  money_amount_rub: number;
  exchange_ticket_count: number;
  allows_ticket_exchange: number;
};

export type PrizeClaimData = {
  message: string;
};

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

/** Текст ответа пользователя для админки (новый и старый формат). */
export function formatPrizeClaimMessage(claim: Record<string, unknown> | null): string {
  if (!claim) return "";
  const msg = String(claim.message ?? "").trim();
  if (msg) return msg;
  const parts: string[] = [];
  if (claim.choice === "tickets" && Array.isArray(claim.ticket_numbers)) {
    parts.push("Обмен на номерки: " + (claim.ticket_numbers as number[]).map((n) => `№${n}`).join(", "));
  }
  if (claim.recipient_name) parts.push("Получатель: " + String(claim.recipient_name));
  if (claim.phone) parts.push("Телефон: " + String(claim.phone));
  if (claim.bank) parts.push("Банк: " + String(claim.bank));
  if (claim.address) parts.push("Адрес: " + String(claim.address));
  if (claim.comment) parts.push(String(claim.comment));
  return parts.join("\n");
}

export function prizeAwardToDto(row: PrizeAwardRow, user?: { name: string; phone: string }) {
  const claim = parseClaimData(row);
  const response_message = formatPrizeClaimMessage(claim);
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
    response_message,
    admin_notes: row.admin_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    claimed_at: row.claimed_at,
    admin_marked_done_at: row.admin_marked_done_at,
    chat_message_id: row.chat_message_id,
  };
}

export async function prizeAwardToDtoAsync(row: PrizeAwardRow, user?: { name: string; phone: string }) {
  return prizeAwardToDto(row, user);
}

export function buildPrizeClaimChatBody(
  prizeId: number,
  title: string,
  intro?: string,
  answerHint?: string,
): string {
  const safeTitle = String(title || "Приз").trim() || "Приз";
  const lines: string[] = [];
  if (intro && String(intro).trim()) {
    lines.push(String(intro).trim());
    lines.push("");
  }
  lines.push("🎉 Поздравляем! Вы выиграли приз.");
  lines.push(`Приз: «${safeTitle}».`);
  const hint = String(answerHint ?? "").trim();
  if (hint) {
    lines.push("");
    lines.push("Что указать в ответе:");
    lines.push(hint);
  }
  lines.push("");
  lines.push("Нажмите кнопку ниже, напишите ответ в окне и отправьте — мы получим его в разделе «Призы».");
  const payload = {
    kind: "prize_claim",
    title: "Получить приз",
    subtitle: safeTitle,
    prize_id: prizeId,
    cta: "Получить приз",
    claim_url: `/home/prize/${prizeId}`,
  };
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return lines.join("\n") + `\n\n[[AB_CARD:${encoded}]]`;
}

export async function createPrizeAward(input: {
  userId: number;
  title: string;
  description?: string;
  createdByUserId: number | null;
  introMessage?: string;
  sendChat?: boolean;
}): Promise<{ ok: true; prize: PrizeAwardRow; messageId?: number } | { ok: false; error: string }> {
  const user = await getUserById(input.userId);
  if (!user) return { ok: false, error: "Пользователь не найден" };
  const title = String(input.title || "").trim();
  if (!title) return { ok: false, error: "Укажите название приза" };
  const description = String(input.description || "").trim();
  const ts = nowMs();
  const inserted = await pgGet<{ id: number }>(
    `INSERT INTO prize_awards (
      user_id, title, description, prize_type, status, claim_data, admin_notes,
      created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, 'physical', 'pending', '', '', ?, ?, ?) RETURNING id`,
    [input.userId, title, description, input.createdByUserId, ts, ts],
  );
  const id = Number(inserted?.id || 0);
  if (!id) return { ok: false, error: "Не удалось создать приз" };
  const row = await pgGet<PrizeAwardRow>(`SELECT * FROM prize_awards WHERE id = ?`, [id]);
  if (!row) return { ok: false, error: "Не удалось создать приз" };

  let messageId: number | undefined;
  if (input.sendChat !== false) {
    const body = buildPrizeClaimChatBody(row.id, title, input.introMessage, description);
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
      `(LOWER(p.title) LIKE ? OR LOWER(u.name) LIKE ? OR u.phone LIKE ? OR CAST(p.id AS TEXT) = ? OR LOWER(p.claim_data) LIKE ?)`,
    );
    const like = `%${q}%`;
    params.push(like, like, `%${q.replace(/\D/g, "")}%`, q.replace(/\D/g, "") || q, like);
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
         WHEN 'pending' THEN 1
         WHEN 'done' THEN 2
         ELSE 3
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
  data: PrizeClaimData | Record<string, unknown>,
): Promise<{ ok: true; prize: PrizeAwardRow } | { ok: false; error: string }> {
  const row = await getPrizeAwardForUser(id, userId);
  if (!row) return { ok: false, error: "Приз не найден" };
  if (row.status === "done" || row.status === "cancelled") {
    return { ok: false, error: "Этот приз уже обработан" };
  }
  if (row.claimed_at) {
    return { ok: false, error: "Ответ уже отправлен. Если нужно изменить — напишите в поддержку." };
  }

  const message = String((data as Record<string, unknown>).message ?? "").trim();
  if (message.length < 2) {
    return { ok: false, error: "Напишите ответ" };
  }

  const ts = nowMs();
  const claimPayload: PrizeClaimData = { message: message.slice(0, 4000) };

  await pgExec(
    `UPDATE prize_awards SET status = 'claimed', claim_data = ?, claimed_at = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(claimPayload), ts, ts, id],
  );
  const updated = await getPrizeAwardById(id);
  if (!updated) return { ok: false, error: "Ошибка сохранения" };
  return { ok: true, prize: updated };
}

export async function updatePrizeAwardAdmin(
  id: number,
  patch: {
    admin_notes?: string;
    mark_done?: boolean;
  },
): Promise<{ ok: true; prize: PrizeAwardRow } | { ok: false; error: string }> {
  const row = await getPrizeAwardById(id);
  if (!row) return { ok: false, error: "Приз не найден" };

  const ts = nowMs();
  const markDone = !!patch.mark_done;
  const status: PrizeStatus = markDone ? "done" : row.status;
  const admin_marked_done_at = markDone ? ts : row.admin_marked_done_at;

  await pgExec(
    `UPDATE prize_awards SET
      status = ?,
      admin_notes = ?,
      admin_marked_done_at = ?,
      updated_at = ?
     WHERE id = ?`,
    [
      status,
      patch.admin_notes !== undefined ? String(patch.admin_notes) : row.admin_notes,
      admin_marked_done_at,
      ts,
      id,
    ],
  );

  const updated = await getPrizeAwardById(id);
  if (!updated) return { ok: false, error: "Ошибка сохранения" };
  return { ok: true, prize: updated };
}

export { messageToDto };
