"use client";

import { useSiteOnlineCount } from "../../lib/use-site-online-count";

export default function HomeHeaderOnline() {
  const count = useSiteOnlineCount(true);

  if (count === null || count < 1) return null;

  return (
    <div className="home-online-chip" aria-live="polite" title={`${count} на сайте`}>
      <span className="home-online-chip__dot-wrap" aria-hidden="true">
        <span className="home-online-chip__ping" />
        <span className="home-online-chip__dot" />
      </span>
      <span className="home-online-chip__count">{count}</span>
      <span className="home-online-chip__label">онлайн</span>
    </div>
  );
}
