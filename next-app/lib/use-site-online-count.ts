"use client";

import { useEffect, useState } from "react";

export function useSiteOnlineCount(enabled: boolean) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      return;
    }
    let cancelled = false;
    fetch("/api/public/site-online-count", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { site_online_count?: number }) => {
        if (cancelled) return;
        const n = Number(d.site_online_count);
        if (Number.isFinite(n)) setCount(Math.max(0, n));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onEv = (e: Event) => {
      const ce = e as CustomEvent<{ count?: number }>;
      const n = Number(ce.detail?.count);
      if (Number.isFinite(n)) setCount(Math.max(0, n));
    };
    window.addEventListener("ab-site-online", onEv as EventListener);
    return () => window.removeEventListener("ab-site-online", onEv as EventListener);
  }, [enabled]);

  return count;
}
