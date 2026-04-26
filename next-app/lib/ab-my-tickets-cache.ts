"use client";

import { abAuthHeaders } from "./ab-api";

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

export function invalidateAbMyTicketsCache(): void {
  myTicketsCache = null;
}

export async function getAbMyTicketsCached(opts?: { force?: boolean; ttlMs?: number }): Promise<AbMyTicketsResponse> {
  const force = Boolean(opts?.force);
  const ttlMs = Math.max(0, Math.floor(Number(opts?.ttlMs ?? 5000)));
  const now = Date.now();
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
      return next;
    })();
  }
  try {
    return await myTicketsInFlight;
  } finally {
    myTicketsInFlight = null;
  }
}
