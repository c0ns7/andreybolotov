import {
  clearRaffleLaunchNotifySent,
  getRaffleById,
  getUserById,
  isRaffleVisibleOnSite,
  listUsersForRaffleLaunchEmail,
  markRaffleLaunchNotifySent,
} from "./db.js";
import type { RaffleRow } from "./db.js";
import {
  formatRuMoscowDateTime,
  sendOrderFullyReleasedEmail,
  sendRaffleLaunchedEmail,
  sendReceiptRejectedReworkEmail,
  sendReserveExpiringSoonEmail,
  sendStaffChatReplyEmail,
  isSmtpReady,
} from "./mail.js";
import {
  getOrderById,
  listReservedOrdersForExpiryReminder,
  markReserveReminderSent,
  reserveReminderLeadMsFromEnv,
} from "./raffle-orders.js";

let warnedNoSmtp = false;

/** Один раз за жизнь процесса — чтобы было видно, почему писем нет. */
export function warnIfNoSmtpOnce(): void {
  if (isSmtpReady() || warnedNoSmtp) return;
  warnedNoSmtp = true;
  console.warn(
    "[notify] SMTP не настроен (SMTP_HOST, SMTP_USER, SMTP_PASS) — письма о чате и акциях не отправляются.",
  );
}

function appOrigin(): string {
  const u = process.env.APP_PUBLIC_URL?.trim() || process.env.SITE_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://127.0.0.1:4321";
}

/** Сразу после ответа поддержки: письмо с текстом сообщения (если включено в настройках). */
export function notifyUserEmailStaffReply(
  userId: number,
  payload: { body: string; attachmentName: string | null; attachmentMime: string | null },
): void {
  warnIfNoSmtpOnce();
  if (!isSmtpReady()) return;
  const u = getUserById(userId);
  if (!u || u.blocked === 1) return;
  if (Number(u.email_notify_chat ?? 1) === 0) return;
  const email = String(u.email || "").trim();
  if (!email) return;

  let attachmentHint: string | null = null;
  const name = payload.attachmentName?.trim() || "";
  const mime = String(payload.attachmentMime || "").toLowerCase();
  if (name || mime) {
    if (mime.startsWith("image/")) {
      attachmentHint = name ? `Изображение: ${name}` : "К сообщению приложено изображение (смотрите в чате).";
    } else {
      attachmentHint = name ? `Файл: ${name}` : "К сообщению приложён файл (смотрите в чате).";
    }
  }

  const openUrl = `${appOrigin()}/home`;
  void sendStaffChatReplyEmail({
    to: email,
    name: u.name,
    body: payload.body,
    attachmentHint,
    openChatUrl: openUrl,
  }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notify] письмо с ответом поддержки user", userId, msg);
  });
}

function raffleIsLaunched(r: RaffleRow): boolean {
  return isRaffleVisibleOnSite(r) && r.status === "active";
}

/** После сохранения акции: сбросить флаг рассылки, если акция не на сайте / не активна. */
export function syncRaffleLaunchNotifyFlag(row: RaffleRow): void {
  if (!raffleIsLaunched(row)) {
    clearRaffleLaunchNotifySent(row.id);
  }
}

/**
 * Рассылка «акция на сайте», один раз на цикл «запуска» (пока снова не скроют или не снимут с активных).
 */
export async function maybeSendRaffleLaunchEmails(raffleId: number): Promise<void> {
  const next = getRaffleById(raffleId);
  if (!next) return;
  syncRaffleLaunchNotifyFlag(next);
  const fresh = getRaffleById(raffleId);
  if (!fresh) return;
  if (!raffleIsLaunched(fresh)) return;
  if (Number(fresh.launch_notify_sent_at ?? 0) > 0) return;
  warnIfNoSmtpOnce();
  if (!isSmtpReady()) {
    console.warn("[notify] raffle launch: SMTP не настроен — письма не отправлены (акция id=" + fresh.id + ")");
    return;
  }
  const now = Date.now();
  const users = listUsersForRaffleLaunchEmail();
  const raffleUrl = `${appOrigin()}/home/raffle?id=${encodeURIComponent(String(fresh.id))}`;
  for (const u of users) {
    try {
      await sendRaffleLaunchedEmail(u.email, u.name, fresh.title, raffleUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[notify] raffle launch email user", u.id, msg);
    }
  }
  markRaffleLaunchNotifySent(fresh.id, now);
}

/**
 * Периодически с сервера: письмо пользователю, если до конца брони осталось не больше
 * RAFFLE_RESERVE_REMINDER_MINUTES (по умол. 5), SMTP настроен, включены письма об акциях.
 */
export function tickReserveExpiryEmailReminders(): void {
  const lead = reserveReminderLeadMsFromEnv();
  if (lead <= 0) return;
  if (!isSmtpReady()) return;
  const now = Date.now();
  const rows = listReservedOrdersForExpiryReminder(now, lead);
  if (rows.length === 0) return;
  for (const r of rows) {
    const u = getUserById(r.user_id);
    if (!u || u.blocked === 1) continue;
    if (Number(u.email_notify_raffle_orders ?? 1) === 0) continue;
    const email = String(u.email || "").trim();
    if (!email) continue;
    const raffle = getRaffleById(r.raffle_id);
    if (!raffle) continue;
    const openRaffleUrl = `${appOrigin()}/home/raffle?id=${encodeURIComponent(String(raffle.id))}`;
    const minutesLeft = Math.ceil((r.reserved_until - now) / 60_000);
    const ord = getOrderById(r.order_id);
    const tok = ord ? String((ord as { public_status_token?: string }).public_status_token ?? "").trim() : "";
    const statusPageUrl = tok
      ? `${appOrigin()}/home/order-status?t=${encodeURIComponent(tok)}`
      : "";
    const rulesUrl = String(raffle.rules_url ?? "").trim();
    void sendReserveExpiringSoonEmail({
      to: email,
      name: u.name,
      raffleTitle: raffle.title,
      orderPublicId: `A${r.order_id}`,
      minutesLeft,
      amountRub: r.amount_rub,
      ticketCount: r.ticket_count,
      openRaffleUrl,
      deadlineMoscow: formatRuMoscowDateTime(r.reserved_until),
      statusPageUrl,
      rulesUrl: rulesUrl || undefined,
    })
      .then(() => markReserveReminderSent(r.order_id))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[notify] reserve expiry reminder order", r.order_id, msg);
      });
  }
}

/** После отклонения чека: вернули заявку в бронь — письмо с дедлайном нового чека. */
export function notifyUserReceiptRejectedRework(
  userId: number,
  payload: {
    raffleTitle: string;
    orderPublicId: string;
    amountRub: number;
    ticketCount: number;
    reservedUntilMs: number;
    openRaffleUrl: string;
    adminNote?: string;
    statusPageUrl?: string;
    rulesUrl?: string;
  },
): void {
  warnIfNoSmtpOnce();
  if (!isSmtpReady()) return;
  const u = getUserById(userId);
  if (!u || u.blocked === 1) return;
  if (Number(u.email_notify_raffle_orders ?? 1) === 0) return;
  const email = String(u.email || "").trim();
  if (!email) return;
  void sendReceiptRejectedReworkEmail({
    to: email,
    name: u.name,
    raffleTitle: payload.raffleTitle,
    orderPublicId: payload.orderPublicId,
    amountRub: payload.amountRub,
    ticketCount: payload.ticketCount,
    openRaffleUrl: payload.openRaffleUrl,
    deadlineMoscow: formatRuMoscowDateTime(payload.reservedUntilMs),
    adminNote: payload.adminNote,
    statusPageUrl: payload.statusPageUrl,
    rulesUrl: payload.rulesUrl,
  }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notify] receipt rejected email user", userId, msg);
  });
}

export function notifyUserOrderFullyReleased(
  userId: number,
  payload: {
    raffleTitle: string;
    orderPublicId: string;
    reason: string;
    openHomeUrl: string;
    statusPageUrl?: string;
    rulesUrl?: string;
    adminNote?: string;
  },
): void {
  warnIfNoSmtpOnce();
  if (!isSmtpReady()) return;
  const u = getUserById(userId);
  if (!u || u.blocked === 1) return;
  if (Number(u.email_notify_raffle_orders ?? 1) === 0) return;
  const email = String(u.email || "").trim();
  if (!email) return;
  void sendOrderFullyReleasedEmail({
    to: email,
    name: u.name,
    raffleTitle: payload.raffleTitle,
    orderPublicId: payload.orderPublicId,
    reason: payload.reason,
    openHomeUrl: payload.openHomeUrl,
    statusPageUrl: payload.statusPageUrl,
    rulesUrl: payload.rulesUrl,
    adminNote: payload.adminNote,
  }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notify] order released email user", userId, msg);
  });
}
