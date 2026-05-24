import { parseChatAttachmentFromMessage } from "./chat-attachments.js";
import { deleteSupportStaffMessageForUser, getRaffleById, getUserById, getUserByPhone, insertSupportMessage, messageToDto } from "./db.js";
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
  ticket_number: number | null;
  money_amount_rub: number;
  exchange_ticket_count: number;
  allows_ticket_exchange: number;
};

export type PrizeClaimData = {
  message: string;
};

export const PRIZE_STAGE_LABELS: Record<PrizeStatus, string> = {
  pending: "Ждёт ответа",
  claimed: "Ответ получен",
  processing: "На выполнении",
  done: "Выполнен",
  cancelled: "Отменён",
};

export function getPrizeStageLabel(status: PrizeStatus | string): string {
  const s = String(status || "pending") as PrizeStatus;
  return PRIZE_STAGE_LABELS[s] || s;
}

export function parseTicketNumbersInput(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0),
      ),
    ];
  }
  const s = String(raw ?? "").trim();
  if (!s) return [];
  return [
    ...new Set(
      s
        .split(/[,;\s]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => Math.floor(Number(p.replace(/^№?#?/, ""))))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
}

export type RaffleTicketHolder = {
  ticket_number: number;
  user_id: number;
  user_name: string;
  user_phone: string;
};

export async function resolveRaffleTicketHolders(
  raffleId: number,
  ticketNumbers: number[],
): Promise<{ holders: RaffleTicketHolder[]; not_found: number[] }> {
  const raffle = await getRaffleById(raffleId);
  if (!raffle) return { holders: [], not_found: ticketNumbers };

  const holders: RaffleTicketHolder[] = [];
  const not_found: number[] = [];

  for (const num of ticketNumbers) {
    const row = await pgGet<{ ticket_number: number; user_id: number; user_name: string; user_phone: string }>(
      `SELECT h.ticket_number, h.user_id, u.name AS user_name, u.phone AS user_phone
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       INNER JOIN users u ON u.id = h.user_id
       WHERE h.raffle_id = ? AND h.ticket_number = ?
         AND o.status NOT IN ('expired', 'rejected')
       ORDER BY CASE WHEN o.status = 'confirmed' THEN 0 WHEN o.status = 'pending_review' THEN 1 ELSE 2 END, o.id DESC
       LIMIT 1`,
      [raffleId, num],
    );
    if (row) {
      holders.push({
        ticket_number: row.ticket_number,
        user_id: row.user_id,
        user_name: row.user_name,
        user_phone: row.user_phone,
      });
      continue;
    }
    const pre = await pgGet<{ phone: string }>(
      `SELECT phone FROM raffle_phone_preassignments WHERE raffle_id = ? AND ticket_number = ?`,
      [raffleId, num],
    );
    if (pre?.phone) {
      const user = await getUserByPhone(pre.phone);
      if (user) {
        holders.push({
          ticket_number: num,
          user_id: user.id,
          user_name: user.name,
          user_phone: user.phone,
        });
        continue;
      }
    }
    not_found.push(num);
  }

  return { holders, not_found };
}

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

export function prizeAwardToDto(
  row: PrizeAwardRow,
  user?: { name: string; phone: string },
  raffle?: { id: number; title: string } | null,
) {
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
    status_label: getPrizeStageLabel(row.status),
    claim_data: claim,
    response_message,
    admin_notes: row.admin_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    claimed_at: row.claimed_at,
    admin_marked_done_at: row.admin_marked_done_at,
    chat_message_id: row.chat_message_id,
    raffle_id: row.raffle_id,
    raffle_title: raffle?.title ?? "",
    ticket_number: row.ticket_number,
  };
}

export async function prizeAwardToDtoAsync(
  row: PrizeAwardRow,
  user?: { name: string; phone: string },
  raffle?: { id: number; title: string } | null,
) {
  if (!raffle && row.raffle_id) {
    const r = await getRaffleById(row.raffle_id);
    if (r) raffle = { id: r.id, title: r.title };
  }
  return prizeAwardToDto(row, user, raffle);
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
  lines.push("Нажмите кнопку ниже и отправьте ответ в открывшемся окне.");
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

export function buildPrizeStageChatBody(title: string, stageLabel: string): string {
  const safeTitle = String(title || "Приз").trim() || "Приз";
  const safeStage = String(stageLabel || "").trim() || "обновлён";
  return (
    `📦 Обновление по призу «${safeTitle}».\n\n` +
    `Этап: ${safeStage}.\n\n` +
    "Если остались вопросы — напишите в этот чат."
  );
}

/** Сообщение в чат при отметке «Выполнен» (с просьбой об отзыве в приватном чате). */
export function buildPrizeDoneChatBody(title: string): string {
  const safeTitle = String(title || "Приз").trim() || "Приз";
  return (
    `✅ Приз «${safeTitle}» выполнен!\n\n` +
    "Пожалуйста, оставьте отзыв в нашем приватном чате.\n\n" +
    "Если остались вопросы — напишите в этот чат."
  );
}

export async function createPrizeAward(input: {
  userId: number;
  title: string;
  description?: string;
  createdByUserId: number | null;
  introMessage?: string;
  sendChat?: boolean;
  raffleId?: number | null;
  ticketNumber?: number | null;
}): Promise<{ ok: true; prize: PrizeAwardRow; messageId?: number } | { ok: false; error: string }> {
  const user = await getUserById(input.userId);
  if (!user) return { ok: false, error: "Пользователь не найден" };
  const title = String(input.title || "").trim();
  if (!title) return { ok: false, error: "Укажите название приза" };
  const description = String(input.description || "").trim();
  const raffleId =
    input.raffleId != null && Number.isFinite(Number(input.raffleId)) && Number(input.raffleId) > 0
      ? Math.floor(Number(input.raffleId))
      : null;
  const ticketNumber =
    input.ticketNumber != null && Number.isFinite(Number(input.ticketNumber)) && Number(input.ticketNumber) > 0
      ? Math.floor(Number(input.ticketNumber))
      : null;
  const ts = nowMs();
  const inserted = await pgGet<{ id: number }>(
    `INSERT INTO prize_awards (
      user_id, title, description, prize_type, status, claim_data, admin_notes,
      created_by_user_id, created_at, updated_at, raffle_id, ticket_number
    ) VALUES (?, ?, ?, 'physical', 'pending', '', '', ?, ?, ?, ?, ?) RETURNING id`,
    [input.userId, title, description, input.createdByUserId, ts, ts, raffleId, ticketNumber],
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

export const MAX_PRIZE_RECIPIENTS = 20;

export async function createPrizeAwardsBulk(input: {
  userIds: number[];
  title: string;
  description?: string;
  createdByUserId: number | null;
  introMessage?: string;
  sendChat?: boolean;
}): Promise<
  | {
      ok: true;
      created: number;
      prizes: PrizeAwardRow[];
      failed: { user_id: number; error: string }[];
    }
  | { ok: false; error: string }
> {
  const ids = [
    ...new Set(
      input.userIds.map((x) => Math.floor(Number(x))).filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  if (!ids.length) return { ok: false, error: "Выберите хотя бы одного получателя" };
  if (ids.length > MAX_PRIZE_RECIPIENTS) {
    return { ok: false, error: `Можно выбрать не больше ${MAX_PRIZE_RECIPIENTS} человек за раз` };
  }

  const prizes: PrizeAwardRow[] = [];
  const failed: { user_id: number; error: string }[] = [];

  for (const userId of ids) {
    const res = await createPrizeAward({
      userId,
      title: input.title,
      description: input.description,
      createdByUserId: input.createdByUserId,
      introMessage: input.introMessage,
      sendChat: input.sendChat,
    });
    if (res.ok) prizes.push(res.prize);
    else failed.push({ user_id: userId, error: res.error });
  }

  if (!prizes.length) {
    return { ok: false, error: failed[0]?.error || "Не удалось создать призы" };
  }

  return { ok: true, created: prizes.length, prizes, failed };
}

export async function createPrizeAwardsFromTickets(input: {
  raffleId: number;
  ticketNumbers: number[];
  title: string;
  description?: string;
  createdByUserId: number | null;
  introMessage?: string;
  sendChat?: boolean;
}): Promise<
  | {
      ok: true;
      created: number;
      prizes: PrizeAwardRow[];
      failed: { ticket_number: number; error: string }[];
      not_found: number[];
    }
  | { ok: false; error: string }
> {
  const raffleId = Math.floor(Number(input.raffleId));
  if (!Number.isFinite(raffleId) || raffleId < 1) return { ok: false, error: "Выберите акцию" };
  const ticketNumbers = parseTicketNumbersInput(input.ticketNumbers);
  if (!ticketNumbers.length) return { ok: false, error: "Укажите номерки победителей" };
  if (ticketNumbers.length > MAX_PRIZE_RECIPIENTS) {
    return { ok: false, error: `Можно указать не больше ${MAX_PRIZE_RECIPIENTS} номерков за раз` };
  }

  const resolved = await resolveRaffleTicketHolders(raffleId, ticketNumbers);
  if (!resolved.holders.length) {
    return {
      ok: false,
      error:
        resolved.not_found.length > 0
          ? `Номерки не найдены: ${resolved.not_found.map((n) => `№${n}`).join(", ")}`
          : "Не удалось найти владельцев номерков",
    };
  }

  const prizes: PrizeAwardRow[] = [];
  const failed: { ticket_number: number; error: string }[] = [];

  for (const holder of resolved.holders) {
    const res = await createPrizeAward({
      userId: holder.user_id,
      title: input.title,
      description: input.description,
      createdByUserId: input.createdByUserId,
      introMessage: input.introMessage,
      sendChat: input.sendChat,
      raffleId,
      ticketNumber: holder.ticket_number,
    });
    if (res.ok) prizes.push(res.prize);
    else failed.push({ ticket_number: holder.ticket_number, error: res.error });
  }

  if (!prizes.length) {
    return { ok: false, error: failed[0]?.error || "Не удалось создать призы" };
  }

  return { ok: true, created: prizes.length, prizes, failed, not_found: resolved.not_found };
}

export async function listPrizeAwardsForAdmin(opts: {
  status?: string;
  q?: string;
  offset?: number;
  limit?: number;
}): Promise<{
  prizes: PrizeAwardRow[];
  users: Map<number, { name: string; phone: string }>;
  raffles: Map<number, { id: number; title: string }>;
  total: number;
}> {
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

  const rows = await pgAll<
    PrizeAwardRow & { user_name: string; user_phone: string; raffle_title: string | null }
  >(
    `SELECT p.*, u.name AS user_name, u.phone AS user_phone, r.title AS raffle_title
     FROM prize_awards p
     INNER JOIN users u ON u.id = p.user_id
     LEFT JOIN raffles r ON r.id = p.raffle_id
     WHERE ${whereSql}
     ORDER BY
       CASE WHEN p.raffle_id IS NULL THEN 1 ELSE 0 END ASC,
       COALESCE(r.created_at, 0) DESC,
       COALESCE(r.id, 0) DESC,
       CASE p.status
         WHEN 'claimed' THEN 0
         WHEN 'processing' THEN 1
         WHEN 'pending' THEN 2
         WHEN 'done' THEN 3
         ELSE 4
       END,
       p.created_at DESC,
       COALESCE(p.ticket_number, 999999) ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const users = new Map<number, { name: string; phone: string }>();
  const raffles = new Map<number, { id: number; title: string }>();
  const prizes: PrizeAwardRow[] = [];
  for (const r of rows) {
    users.set(r.user_id, { name: r.user_name, phone: r.user_phone });
    if (r.raffle_id && r.raffle_title) {
      raffles.set(r.raffle_id, { id: r.raffle_id, title: r.raffle_title });
    }
    prizes.push(r);
  }
  return { prizes, users, raffles, total };
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

function parseOptionalRaffleId(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseOptionalTicketNumber(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export async function updatePrizeAwardAdmin(
  id: number,
  patch: {
    admin_notes?: string;
    mark_done?: boolean;
    status?: PrizeStatus;
    notify_chat?: boolean;
    title?: string;
    description?: string;
    raffle_id?: number | null;
    ticket_number?: number | null;
    done_attachment?: unknown;
  },
): Promise<
  | { ok: true; prize: PrizeAwardRow; stage_message_id?: number; status_changed: boolean }
  | { ok: false; error: string }
> {
  const row = await getPrizeAwardById(id);
  if (!row) return { ok: false, error: "Приз не найден" };

  const ts = nowMs();
  const markDone = !!patch.mark_done;
  let nextStatus: PrizeStatus = row.status;

  if (markDone) {
    nextStatus = "done";
  } else if (patch.status) {
    const s = String(patch.status) as PrizeStatus;
    if (s === "processing" || s === "cancelled") {
      if (row.status === "done") return { ok: false, error: "Приз уже выполнен" };
      nextStatus = s;
    }
  }

  let nextTitle = row.title;
  if (patch.title !== undefined) {
    const title = String(patch.title || "").trim();
    if (!title) return { ok: false, error: "Укажите название приза" };
    nextTitle = title;
  }

  let nextDescription = row.description;
  if (patch.description !== undefined) {
    nextDescription = String(patch.description || "").trim();
  }

  let nextRaffleId = row.raffle_id;
  const raffleIdPatch = parseOptionalRaffleId(patch.raffle_id);
  if (raffleIdPatch !== undefined) {
    if (raffleIdPatch != null) {
      const raffle = await getRaffleById(raffleIdPatch);
      if (!raffle) return { ok: false, error: "Акция не найдена" };
    }
    nextRaffleId = raffleIdPatch;
  }

  let nextTicketNumber = row.ticket_number;
  const ticketPatch = parseOptionalTicketNumber(patch.ticket_number);
  if (ticketPatch !== undefined) {
    nextTicketNumber = ticketPatch;
  }

  if (raffleIdPatch !== undefined && raffleIdPatch === null) {
    nextTicketNumber = null;
  }

  if (nextTicketNumber != null && nextRaffleId == null) {
    return { ok: false, error: "Сначала выберите акцию для номерка" };
  }

  if (nextRaffleId != null && nextTicketNumber != null) {
    const resolved = await resolveRaffleTicketHolders(nextRaffleId, [nextTicketNumber]);
    const holder = resolved.holders[0];
    if (!holder) {
      return { ok: false, error: `Номерок №${nextTicketNumber} не найден в этой акции` };
    }
    if (holder.user_id !== row.user_id) {
      return {
        ok: false,
        error: `Номерок №${nextTicketNumber} принадлежит другому участнику (${holder.user_name})`,
      };
    }
  }

  let doneAttachment: { url: string; name: string; mime: string } | null = null;
  if (markDone && patch.done_attachment !== undefined && patch.done_attachment !== null) {
    doneAttachment = parseChatAttachmentFromMessage(patch.done_attachment);
    if (!doneAttachment) return { ok: false, error: "Некорректное вложение" };
  }

  const statusChanged = nextStatus !== row.status;
  const admin_marked_done_at = markDone || nextStatus === "done" ? (row.admin_marked_done_at ?? ts) : row.admin_marked_done_at;

  await pgExec(
    `UPDATE prize_awards SET
      status = ?,
      title = ?,
      description = ?,
      raffle_id = ?,
      ticket_number = ?,
      admin_notes = ?,
      admin_marked_done_at = ?,
      updated_at = ?
     WHERE id = ?`,
    [
      nextStatus,
      nextTitle,
      nextDescription,
      nextRaffleId,
      nextTicketNumber,
      patch.admin_notes !== undefined ? String(patch.admin_notes) : row.admin_notes,
      admin_marked_done_at,
      ts,
      id,
    ],
  );

  const updated = await getPrizeAwardById(id);
  if (!updated) return { ok: false, error: "Ошибка сохранения" };

  let stage_message_id: number | undefined;
  const shouldNotify = patch.notify_chat !== false && statusChanged && nextStatus !== "cancelled";
  if (shouldNotify && nextStatus === "processing") {
    const body = buildPrizeStageChatBody(updated.title, getPrizeStageLabel(nextStatus));
    stage_message_id = await insertSupportMessage(updated.user_id, body, true, null);
  } else if (shouldNotify && nextStatus === "done") {
    const body = buildPrizeDoneChatBody(updated.title);
    stage_message_id = await insertSupportMessage(updated.user_id, body, true, doneAttachment);
  }

  return { ok: true, prize: updated, stage_message_id, status_changed: statusChanged };
}

export async function deletePrizeAward(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await getPrizeAwardById(id);
  if (!row) return { ok: false, error: "Приз не найден" };

  const chatMessageId = Number(row.chat_message_id || 0);
  if (Number.isFinite(chatMessageId) && chatMessageId > 0) {
    await deleteSupportStaffMessageForUser(row.user_id, chatMessageId);
  }

  await pgExec(`DELETE FROM prize_awards WHERE id = ?`, [id]);
  return { ok: true };
}

export { messageToDto };
