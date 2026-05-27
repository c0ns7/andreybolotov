/** Агинское / Читинское время (UTC+9, +6 к Москве). Копия server/site-timezone.ts для Next-клиента. */
export const SITE_TIMEZONE = "Asia/Chita";
export const SITE_TIMEZONE_LABEL = "Агинское время (UTC+9)";
export const MOSCOW_TIMEZONE = "Europe/Moscow";

const LOCAL_DT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseSiteDateTimeLocalToUtcMs(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = LOCAL_DT_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d) || !Number.isFinite(h) || !Number.isFinite(mi)) {
    return null;
  }
  const utc = Date.UTC(y, mo, d, h - 9, mi);
  if (!Number.isFinite(utc) || utc <= 0) return null;
  return Math.floor(utc);
}

export function formatSiteDateTimeLocalFromUtcMs(ms: number): string {
  const n = Math.floor(Number(ms));
  if (!Number.isFinite(n) || n <= 0) return "";
  try {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: SITE_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(n));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const y = get("year");
    const mo = get("month");
    const d = get("day");
    const h = get("hour");
    const mi = get("minute");
    if (!y || !mo || !d) return "";
    return `${y}-${mo}-${d}T${h}:${mi}`;
  } catch {
    return "";
  }
}

export function formatRuInTimezone(ms: number, timeZone: string): string {
  try {
    return new Date(ms).toLocaleString("ru-RU", {
      timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

export function formatRuSiteDateTime(ms: number): string {
  return formatRuInTimezone(ms, SITE_TIMEZONE);
}

export function formatRuMoscowDateTime(ms: number): string {
  return formatRuInTimezone(ms, MOSCOW_TIMEZONE);
}

export function formatStreamCardShort(ms: number): string {
  try {
    return new Date(ms).toLocaleString("ru-RU", {
      timeZone: SITE_TIMEZONE,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Компактно: сколько осталось до эфира (для плашки на карточке). */
export function formatStreamTimeLeft(targetMs: number, nowMs = Date.now()): string {
  const left = Math.max(0, Math.floor(Number(targetMs)) - Math.floor(Number(nowMs)));
  if (left <= 0) return "";
  const totalSec = Math.floor(left / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}д ${hours.toString().padStart(2, "0")}ч`;
  if (hours > 0) return `${hours}ч ${mins.toString().padStart(2, "0")}м`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function isEpochReached(atMs: number | null | undefined, nowMs = Date.now()): boolean {
  const at = Math.floor(Number(atMs ?? 0));
  if (!Number.isFinite(at) || at <= 0) return true;
  return nowMs >= at;
}
