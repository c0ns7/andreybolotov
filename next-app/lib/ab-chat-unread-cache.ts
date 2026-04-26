"use client";

import { abAuthHeaders } from "./ab-api";

let unreadCache: { ts: number; unread: number } | null = null;
let unreadInFlight: Promise<number> | null = null;

export function invalidateAbChatUnreadCache(): void {
  unreadCache = null;
}

export async function getAbChatUnreadCached(opts?: { force?: boolean; ttlMs?: number }): Promise<number> {
  const force = Boolean(opts?.force);
  const ttlMs = Math.max(0, Math.floor(Number(opts?.ttlMs ?? 3000)));
  const now = Date.now();
  if (!force && unreadCache && now - unreadCache.ts < ttlMs) {
    return unreadCache.unread;
  }
  if (!unreadInFlight) {
    unreadInFlight = (async () => {
      const res = await fetch("/api/chat/unread", { cache: "no-store", headers: abAuthHeaders() });
      const data = (await res.json().catch(() => ({}))) as { unread_staff?: number; error?: string };
      if (!res.ok) throw new Error(String(data.error || "Ошибка загрузки непрочитанного"));
      const unread = Math.max(0, Number(data.unread_staff) || 0);
      unreadCache = { ts: Date.now(), unread };
      return unread;
    })();
  }
  try {
    return await unreadInFlight;
  } finally {
    unreadInFlight = null;
  }
}
