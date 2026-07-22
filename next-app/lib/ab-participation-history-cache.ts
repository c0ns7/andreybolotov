"use client";

import { abAuthHeaders } from "./ab-api";
import { loadAbSession } from "./ab-session";

export type AbParticipationHistoryTimelineStatus =
  | "reserved"
  | "pending_review"
  | "confirmed"
  | "bonus_5plus1"
  | "bonus_5plus2"
  | "bonus_10plus1"
  | "bonus_10plus2";

export type AbParticipationHistoryTimelineEntry = {
  at?: number;
  status?: AbParticipationHistoryTimelineStatus;
  numbers?: number[];
};

export type AbParticipationHistoryPayload = {
  raffles?: Array<{
    raffle?: { title?: string; status?: string };
    timeline?: AbParticipationHistoryTimelineEntry[];
    numbers?: {
      reserved?: number[];
      pending_review?: number[];
      confirmed?: number[];
      bonus_confirmed?: number[];
      bonus_5plus1_confirmed?: number[];
      bonus_5plus2_confirmed?: number[];
      bonus_10plus1_confirmed?: number[];
      bonus_10plus2_confirmed?: number[];
    };
    last_activity_at?: number;
  }>;
};

let historyCache: { ts: number; data: AbParticipationHistoryPayload } | null = null;
let historyInFlight: Promise<AbParticipationHistoryPayload> | null = null;
const HISTORY_CACHE_KEY = "ab_participation_history_cache_v2";

function getStorageKey(): string {
  const s = loadAbSession();
  const phone = String(s?.phone || "").trim();
  return phone ? `${HISTORY_CACHE_KEY}:${phone}` : HISTORY_CACHE_KEY;
}

function readPersistentCache(): { ts: number; data: AbParticipationHistoryPayload } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: unknown; data?: AbParticipationHistoryPayload };
    const ts = Number(parsed?.ts);
    if (!Number.isFinite(ts) || ts <= 0 || !parsed?.data) return null;
    return { ts, data: parsed.data };
  } catch {
    return null;
  }
}

function writePersistentCache(entry: { ts: number; data: AbParticipationHistoryPayload }): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

export function invalidateAbParticipationHistoryCache(): void {
  historyCache = null;
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getStorageKey());
  } catch {
    /* ignore */
  }
}

export async function getAbParticipationHistoryCached(opts?: {
  force?: boolean;
  ttlMs?: number;
}): Promise<AbParticipationHistoryPayload> {
  const force = Boolean(opts?.force);
  const ttlMs = Math.max(0, Math.floor(Number(opts?.ttlMs ?? 10_000)));
  const now = Date.now();
  if (!historyCache) {
    historyCache = readPersistentCache();
  }
  if (!force && historyCache && now - historyCache.ts < ttlMs) {
    return historyCache.data;
  }
  if (!historyInFlight) {
    historyInFlight = (async () => {
      const res = await fetch("/api/raffles/participation-history", { cache: "no-store", headers: abAuthHeaders() });
      const data = (await res.json().catch(() => ({}))) as AbParticipationHistoryPayload & { error?: string };
      if (!res.ok) throw new Error(String(data.error || "Ошибка загрузки истории"));
      const next: AbParticipationHistoryPayload = {
        raffles: Array.isArray(data.raffles) ? data.raffles : [],
      };
      historyCache = { ts: Date.now(), data: next };
      writePersistentCache(historyCache);
      return next;
    })();
  }
  try {
    return await historyInFlight;
  } finally {
    historyInFlight = null;
  }
}
