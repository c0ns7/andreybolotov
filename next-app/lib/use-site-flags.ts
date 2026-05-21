"use client";

import { useCallback, useEffect, useState } from "react";

export type SiteFlags = {
  maintenance: boolean;
  blog_enabled: boolean;
  loaded: boolean;
};

export function useSiteFlags() {
  const [flags, setFlags] = useState<SiteFlags>({
    maintenance: false,
    blog_enabled: false,
    loaded: false,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/site/status", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      setFlags({
        maintenance: !!data.maintenance,
        blog_enabled: !!data.blog_enabled,
        loaded: true,
      });
    } catch {
      setFlags((f) => ({ ...f, loaded: true }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onWs = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(String(evt.data)) as { type?: string; blog_enabled?: boolean; maintenance?: boolean };
        if (msg.type === "site_blog_enabled_updated") {
          setFlags((f) => ({ ...f, blog_enabled: !!msg.blog_enabled, loaded: true }));
        }
        if (msg.type === "site_maintenance_updated") {
          setFlags((f) => ({ ...f, maintenance: !!msg.maintenance, loaded: true }));
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("message", onWs);
    return () => window.removeEventListener("message", onWs);
  }, []);

  return { ...flags, refresh };
}
