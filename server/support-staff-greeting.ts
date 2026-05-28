import { pgGet } from "./pg-sql.js";
import { parseSiteDateTimeLocalToUtcMs, SITE_TIMEZONE } from "./site-timezone.js";

const STAFF_GREETING_RE = /^\s*здравствуйте\b/i;

/** Границы текущих суток по часовому поясу сайта (Агинское / Чита). */
export function getSiteCalendarDayBoundsMs(nowMs = Date.now()): { startMs: number; endMs: number } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: SITE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const y = get("year");
  const mo = get("month");
  const d = get("day");
  const startMs = parseSiteDateTimeLocalToUtcMs(`${y}-${mo}-${d}T00:00`) ?? nowMs;
  return { startMs, endMs: startMs + 86400000 };
}

export function staffSupportMessageHasGreeting(text: string): boolean {
  return STAFF_GREETING_RE.test(String(text ?? "").trim());
}

async function countStaffSupportMessagesForUserBetween(
  userId: number,
  startMs: number,
  endMs: number,
): Promise<number> {
  const row = await pgGet<{ c?: number }>(
    `SELECT COUNT(*)::int AS c FROM support_messages
     WHERE user_id = ? AND is_staff = 1 AND created_at >= ? AND created_at < ?`,
    [userId, startMs, endMs],
  );
  return Math.max(0, Number(row?.c ?? 0));
}

/**
 * Первый ответ поддержки пользователю за сутки (по времени сайта): если нет «Здравствуйте» в начале — добавить.
 */
export async function applyStaffSupportGreetingForUser(userId: number, rawText: string): Promise<string> {
  const text = String(rawText ?? "");
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (staffSupportMessageHasGreeting(trimmed)) return text;
  const { startMs, endMs } = getSiteCalendarDayBoundsMs();
  const priorToday = await countStaffSupportMessagesForUserBetween(userId, startMs, endMs);
  if (priorToday > 0) return text;
  return `Здравствуйте.\n\n${trimmed}`;
}
