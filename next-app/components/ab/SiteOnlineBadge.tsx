"use client";

import { usePathname } from "next/navigation";
import { useSiteOnlineCount } from "../../lib/use-site-online-count";

function shouldShowSiteOnline(pathname: string): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  if (p === "/home") return false;
  if (p.startsWith("/home/raffle")) return true;
  if (p.startsWith("/raffle/")) return true;
  return false;
}

export default function SiteOnlineBadge() {
  const pathname = usePathname() || "/";
  const count = useSiteOnlineCount(shouldShowSiteOnline(pathname));

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
      <span className="site-online-badge__text">{count} онлайн</span>
    </div>
  );
}
