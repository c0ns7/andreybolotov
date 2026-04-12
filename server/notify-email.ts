import {
  clearRaffleLaunchNotifySent,
  getRaffleById,
  isRaffleVisibleOnSite,
  listUsersForChatUnreadEmailReminder,
  listUsersForRaffleLaunchEmail,
  markRaffleLaunchNotifySent,
  setUserChatUnreadEmailLastAt,
} from "./db.js";
import type { RaffleRow } from "./db.js";
import { sendChatUnreadReminderEmail, sendRaffleLaunchedEmail, isSmtpReady } from "./mail.js";

function envMs(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

/**
 * Минимальный возраст последнего непрочитанного ответа поддержки перед письмом.
 * Переменная окружения: NOTIFY_CHAT_UNREAD_MIN_AGE_MS (мс). По умолчанию 2 минуты.
 */
export const CHAT_UNREAD_MIN_AGE_MS = envMs("NOTIFY_CHAT_UNREAD_MIN_AGE_MS", 2 * 60 * 1000);
/** Пауза между повторными письмами одному пользователю. NOTIFY_CHAT_UNREAD_COOLDOWN_MS */
export const CHAT_UNREAD_COOLDOWN_MS = envMs("NOTIFY_CHAT_UNREAD_COOLDOWN_MS", 6 * 60 * 60 * 1000);

let warnedNoSmtp = false;

/** Один раз за жизнь процесса — чтобы было видно, почему писем нет. */
export function warnIfNoSmtpOnce(): void {
  if (isSmtpReady() || warnedNoSmtp) return;
  warnedNoSmtp = true;
  console.warn(
    "[notify] SMTP не настроен (SMTP_HOST, SMTP_USER, SMTP_PASS) — письма о непрочитанном чате и новых акциях не отправляются.",
  );
}

/**
 * Дополнительная проверка после ответа поддержки (не ждать только интервал 5 мин).
 * Задержка = max(MIN_AGE + 3с, 30с).
 */
export function scheduleChatUnreadReminderCheck(): void {
  const delay = Math.max(CHAT_UNREAD_MIN_AGE_MS + 3_000, 30_000);
  setTimeout(() => {
    void runChatUnreadEmailReminders().catch((e) =>
      console.error("[notify] отложенная проверка чата:", e instanceof Error ? e.message : e),
    );
  }, delay);
}

function appOrigin(): string {
  const u = process.env.APP_PUBLIC_URL?.trim() || process.env.SITE_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://127.0.0.1:4321";
}

export async function runChatUnreadEmailReminders(): Promise<void> {
  warnIfNoSmtpOnce();
  if (!isSmtpReady()) return;
  const now = Date.now();
  const rows = listUsersForChatUnreadEmailReminder(
    now,
    CHAT_UNREAD_MIN_AGE_MS,
    CHAT_UNREAD_COOLDOWN_MS,
  );
  if (rows.length === 0) return;
  const openUrl = `${appOrigin()}/home`;
  let ok = 0;
  for (const u of rows) {
    try {
      await sendChatUnreadReminderEmail(u.email, u.name, openUrl);
      setUserChatUnreadEmailLastAt(u.id, now);
      ok += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[notify] chat unread email user", u.id, msg);
    }
  }
  if (ok > 0) {
    console.log("[notify] непрочитанный чат: отправлено напоминаний:", ok, "из", rows.length);
  }
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
