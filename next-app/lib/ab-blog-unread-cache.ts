"use client";

import { abAuthHeaders } from "./ab-api";

let unreadCache: { ts: number; unread: number } | null = null;
let unreadInFlight: Promise<number> | null = null;

export function invalidateAbBlogUnreadCache(): void {
  unreadCache = null;
}

export async function getAbBlogUnreadCached(opts?: { force?: boolean; ttlMs?: number }): Promise<number> {
  const force = Boolean(opts?.force);
  const ttlMs = Math.max(0, Math.floor(Number(opts?.ttlMs ?? 5000)));
  const now = Date.now();
  if (!force && unreadCache && now - unreadCache.ts < ttlMs) {
    return unreadCache.unread;
  }
  if (!unreadInFlight) {
    unreadInFlight = (async () => {
      const res = await fetch("/api/blog/unread", { cache: "no-store", headers: abAuthHeaders() });
      const data = (await res.json().catch(() => ({}))) as { unread?: number; error?: string; code?: string };
      if (!res.ok) {
        if (res.status === 403 && data.code === "blog_disabled") return 0;
        throw new Error(String(data.error || "Ошибка загрузки блога"));
      }
      const unread = Math.max(0, Math.floor(Number(data.unread) || 0));
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
