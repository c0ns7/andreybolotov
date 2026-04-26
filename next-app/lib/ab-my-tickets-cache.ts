"use client";

import { abAuthHeaders } from "./ab-api";
import { loadAbSession } from "./ab-session";

export type AbMyTicketsResponse = {
  reserved?: Array<{
    raffle?: { id?: number; title?: string; status?: string };
    numbers?: number[];
    order?: {
      id?: number;
      receipt_reject_count?: number;
      last_reject_comment?: string | null;
    };
  }>;
  pending_review?: Array<{
    raffle?: { id?: number; title?: string; status?: string };
    numbers?: number[];
  }>;
  confirmed?: Array<{
    raffle?: { id?: number; title?: string; status?: string };
    numbers?: number[];
  }>;
};

let myTicketsCache: { ts: number; data: AbMyTicketsResponse } | null = null;
let myTicketsInFlight: Promise<AbMyTicketsResponse> | null = null;
const MY_TICKETS_CACHE_KEY = "ab_my_tickets_cache_v1";

function getStorageKey(): string {
  const s = loadAbSession();
  const phone = String(s?.phone || "").trim();
  return phone ? `${MY_TICKETS_CACHE_KEY}:${phone}` : MY_TICKETS_CACHE_KEY;
}

function readPersistentCache(): { ts: number; data: AbMyTicketsResponse } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: unknown; data?: AbMyTicketsResponse };
    const ts = Number(parsed?.ts);
    if (!Number.isFinite(ts) || ts <= 0 || !parsed?.data) return null;
    return { ts, data: parsed.data };
  } catch {
    return null;
  }
}

function writePersistentCache(entry: { ts: number; data: AbMyTicketsResponse }): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

export function invalidateAbMyTicketsCache(): void {
  myTicketsCache = null;
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getStorageKey());
  } catch {
    /* ignore */
  }
}

export async function getAbMyTicketsCached(opts?: { force?: boolean; ttlMs?: number }): Promise<AbMyTicketsResponse> {
  const force = Boolean(opts?.force);
  const ttlMs = Math.max(0, Math.floor(Number(opts?.ttlMs ?? 5000)));
  const now = Date.now();
  if (!myTicketsCache) {
    myTicketsCache = readPersistentCache();
  }
  if (!force && myTicketsCache && now - myTicketsCache.ts < ttlMs) {
    return myTicketsCache.data;
  }
  if (!myTicketsInFlight) {
    myTicketsInFlight = (async () => {
      const res = await fetch("/api/raffles/my-tickets", { cache: "no-store", headers: abAuthHeaders() });
      const data = (await res.json().catch(() => ({}))) as AbMyTicketsResponse & { error?: string };
      if (!res.ok) throw new Error(String(data.error || "Ошибка загрузки билетов"));
      const next: AbMyTicketsResponse = {
        reserved: Array.isArray(data.reserved) ? data.reserved : [],
        pending_review: Array.isArray(data.pending_review) ? data.pending_review : [],
        confirmed: Array.isArray(data.confirmed) ? data.confirmed : [],
      };
      myTicketsCache = { ts: Date.now(), data: next };
      writePersistentCache(myTicketsCache);
      return next;
    })();
  }
  try {
    return await myTicketsInFlight;
  } finally {
    myTicketsInFlight = null;
  }
}
