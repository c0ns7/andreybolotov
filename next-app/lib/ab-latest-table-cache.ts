"use client";

import { abAuthHeaders } from "./ab-api";
import { loadAbSession } from "./ab-session";

export type AbLatestTableRow = {
  n: number;
  status: "free" | "taken" | "self_reserved" | "self_pending" | "self_confirmed";
  phone: string | null;
};

export type AbLatestTablePayload = {
  raffle: { id: number; title: string; ticket_count: number; status: string } | null;
  rows: AbLatestTableRow[];
};

let tableCache: { ts: number; data: AbLatestTablePayload } | null = null;
let tableInFlight: Promise<AbLatestTablePayload> | null = null;
const TABLE_CACHE_KEY = "ab_latest_table_cache_v1";

function getStorageKey(): string {
  const s = loadAbSession();
  const phone = String(s?.phone || "").trim();
  return phone ? `${TABLE_CACHE_KEY}:${phone}` : TABLE_CACHE_KEY;
}

function readPersistentCache(): { ts: number; data: AbLatestTablePayload } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: unknown; data?: AbLatestTablePayload };
    const ts = Number(parsed?.ts);
    if (!Number.isFinite(ts) || ts <= 0 || !parsed?.data) return null;
    return { ts, data: parsed.data };
  } catch {
    return null;
  }
}

function writePersistentCache(entry: { ts: number; data: AbLatestTablePayload }): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

export function invalidateAbLatestTableCache(): void {
  tableCache = null;
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getStorageKey());
  } catch {
    /* ignore */
  }
}

export async function getAbLatestTableCached(opts?: { force?: boolean; ttlMs?: number }): Promise<AbLatestTablePayload> {
  const force = Boolean(opts?.force);
  const ttlMs = Math.max(0, Math.floor(Number(opts?.ttlMs ?? 30_000)));
  const now = Date.now();
  if (!tableCache) {
    tableCache = readPersistentCache();
  }
  if (!force && tableCache && now - tableCache.ts < ttlMs) {
    return tableCache.data;
  }
  if (!tableInFlight) {
    tableInFlight = (async () => {
      const res = await fetch("/api/raffles/latest-visible/table", { cache: "no-store", headers: abAuthHeaders() });
      const data = (await res.json().catch(() => ({}))) as AbLatestTablePayload & { error?: string };
      if (!res.ok) throw new Error(String(data.error || "Ошибка загрузки таблицы"));
      const next: AbLatestTablePayload = {
        raffle: data.raffle || null,
        rows: Array.isArray(data.rows) ? data.rows : [],
      };
      tableCache = { ts: Date.now(), data: next };
      writePersistentCache(tableCache);
      return next;
    })();
  }
  try {
    return await tableInFlight;
  } finally {
    tableInFlight = null;
  }
}
