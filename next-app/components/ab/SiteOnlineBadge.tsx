"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

function shouldShowSiteOnline(pathname: string): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  if (p === "/home") return true;
  if (p.startsWith("/home/raffle")) return true;
  if (p.startsWith("/raffle/")) return true;
  return false;
}

export default function SiteOnlineBadge() {
  const pathname = usePathname() || "/";
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!shouldShowSiteOnline(pathname)) {
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
  }, [pathname]);

  useEffect(() => {
    if (!shouldShowSiteOnline(pathname)) return;
    const onEv = (e: Event) => {
      const ce = e as CustomEvent<{ count?: number }>;
      const n = Number(ce.detail?.count);
      if (Number.isFinite(n)) setCount(Math.max(0, n));
    };
    window.addEventListener("ab-site-online", onEv as EventListener);
    return () => window.removeEventListener("ab-site-online", onEv as EventListener);
  }, [pathname]);

  if (!shouldShowSiteOnline(pathname) || count === null || count < 1) return null;

  return (
    <div
      className="site-online-badge"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      aria-live="polite"
    >
      <span className="site-online-badge__dot-wrap">
        <span className="site-online-badge__ping" aria-hidden="true" />
        <span className="site-online-badge__dot" aria-hidden="true" />
      </span>
      <span className="site-online-badge__text">
        {count} онлайн
      </span>
    </div>
  );
}
