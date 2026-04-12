import {
  clearRaffleLaunchNotifySent,
  getRaffleById,
  getUserById,
  isRaffleVisibleOnSite,
  listUsersForRaffleLaunchEmail,
  markRaffleLaunchNotifySent,
} from "./db.js";
import type { RaffleRow } from "./db.js";
import { sendRaffleLaunchedEmail, sendStaffChatReplyEmail, isSmtpReady } from "./mail.js";

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
