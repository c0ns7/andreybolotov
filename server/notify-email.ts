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

/** Не писать сразу: дать время открыть чат в приложении */
export const CHAT_UNREAD_MIN_AGE_MS = 15 * 60 * 1000;
/** Не дублировать напоминание чаще */
export const CHAT_UNREAD_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function appOrigin(): string {
  const u = process.env.APP_PUBLIC_URL?.trim() || process.env.SITE_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://127.0.0.1:4321";
}

export async function runChatUnreadEmailReminders(): Promise<void> {
  if (!isSmtpReady()) return;
  const now = Date.now();
  const rows = listUsersForChatUnreadEmailReminder(
    now,
    CHAT_UNREAD_MIN_AGE_MS,
    CHAT_UNREAD_COOLDOWN_MS,
  );
  const openUrl = `${appOrigin()}/home`;
  for (const u of rows) {
    try {
      await sendChatUnreadReminderEmail(u.email, u.name, openUrl);
      setUserChatUnreadEmailLastAt(u.id, now);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[notify] chat unread email user", u.id, msg);
    }
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
