"use client";

import { abAuthHeaders } from "./ab-api";

export type AbParticipationHistoryPayload = {
  raffles?: Array<{
    raffle?: { title?: string; status?: string };
    numbers?: { reserved?: number[]; pending_review?: number[]; confirmed?: number[]; bonus_confirmed?: number[] };
    last_activity_at?: number;
  }>;
};

let historyCache: { ts: number; data: AbParticipationHistoryPayload } | null = null;
let historyInFlight: Promise<AbParticipationHistoryPayload> | null = null;

export function invalidateAbParticipationHistoryCache(): void {
  historyCache = null;
}

export async function getAbParticipationHistoryCached(opts?: {
  force?: boolean;
  ttlMs?: number;
}): Promise<AbParticipationHistoryPayload> {
  const force = Boolean(opts?.force);
  const ttlMs = Math.max(0, Math.floor(Number(opts?.ttlMs ?? 10_000)));
  const now = Date.now();
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
      return next;
    })();
  }
  try {
    return await historyInFlight;
  } finally {
    historyInFlight = null;
  }
}
