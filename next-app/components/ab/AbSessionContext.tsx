"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { abApiJson, AbApiError } from "../../lib/ab-api";
import { clearAbSession, loadAbSession, saveAbSession, type AbSession } from "../../lib/ab-session";
import { AB_USER_WS_EVENT } from "../../lib/ab-user-ws-events";
import {
  formatRaffleFreeTicketsReminderPush,
  showAbBrowserNotification,
} from "../../lib/ab-browser-push";
import { buildAbPublicWebSocketUrl, buildAbWebSocketUrl, detachWebSocket } from "../../lib/ab-ws";

/** Должен совпадать с server/raffle-free-tickets-push.ts (30 мин). */
const RAFFLE_FREE_TICKETS_PUSH_INTERVAL_MS = 30 * 60 * 1000;

type AbSessionContextValue = {
  session: AbSession | null;
  authVerified: boolean;
  authCheckInFlight: boolean;
  setSessionFromLogin: (s: AbSession) => void;
  logout: () => void;
  verifySession: () => Promise<void>;
  toast: (message: string, kind?: "success" | "error" | "warning" | "info" | "neutral") => void;
};

const AbSessionContext = createContext<AbSessionContextValue | null>(null);

function syncHtmlAuthClasses(hasToken: boolean, pathname: string, authVerified: boolean) {
  const root = document.documentElement;
  const isGuestLanding = pathname === "/" || pathname === "";
  root.classList.remove("js-has-session", "js-guest", "js-auth-verified");
  if (hasToken && !isGuestLanding) root.classList.add("js-has-session");
  else root.classList.add("js-guest");
  if (authVerified) root.classList.add("js-auth-verified");
}

export function AbSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const routerRef = useRef(router);
  routerRef.current = router;
  const publicWsRef = useRef<WebSocket | null>(null);
  const [session, setSession] = useState<AbSession | null>(() => loadAbSession());
  const [authVerified, setAuthVerified] = useState(false);
  const [authCheckInFlight, setAuthCheckInFlight] = useState(true);

  const toast = useCallback((message: string, kind: "success" | "error" | "warning" | "info" | "neutral" = "neutral") => {
    try {
      window.dispatchEvent(new CustomEvent("ab-toast", { detail: { message, kind } }));
    } catch {
      if (kind === "error") console.error(message);
      else console.info(message);
    }
  }, []);

  const verifySession = useCallback(async () => {
    const s = loadAbSession();
    if (!s?.token) {
      setSession(null);
      setAuthVerified(false);
      setAuthCheckInFlight(false);
      return;
    }
    setSession(s);
    setAuthCheckInFlight(true);
    const ctrl = new AbortController();
    const abortTimer = window.setTimeout(() => ctrl.abort(), 10_000);
    try {
      const data = await abApiJson<{ user: AbSession & { blocked?: boolean; id?: number } }>("/api/auth/me", {
        headers: { Authorization: `Bearer ${s.token}` },
        signal: ctrl.signal,
      });
      const u = data.user;
      const blocked = !!u.blocked;
      const uid = Number((u as { id?: unknown }).id);
      const next: AbSession = {
        ...s,
        id: Number.isFinite(uid) && uid > 0 ? Math.floor(uid) : s.id,
        phone: u.phone,
        name: u.name,
        locality: (u as { locality?: string }).locality || "",
        role: u.role || "user",
        blocked,
      };
      saveAbSession(next);
      setSession(next);
      setAuthVerified(true);
    } catch (e) {
      if (e instanceof AbApiError && e.status === 401) {
        clearAbSession();
        setSession(null);
        setAuthVerified(false);
        return;
      }
      // Сетевой/временный сбой не должен выбрасывать пользователя из локальной сессии.
      setSession(s);
      setAuthVerified(true);
      toast("Связь с сервером нестабильна. Работаем с текущей сессией.", "warning");
    } finally {
      window.clearTimeout(abortTimer);
      setAuthCheckInFlight(false);
    }
  }, [toast]);

  useEffect(() => {
    void verifySession();
  }, [verifySession]);

  useEffect(() => {
    const hasToken = !!(session?.token && session?.phone);
    syncHtmlAuthClasses(hasToken, pathname, authVerified);
  }, [session, pathname, authVerified]);

  useEffect(() => {
    if (pathname === "/" || pathname === "/maintenance") return;
    fetch("/api/site/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.maintenance) return;
        const raw = loadAbSession();
        const hasTok = !!(raw?.token);
        if (!hasTok) {
          router.replace("/maintenance");
          return;
        }
        fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${raw!.token}` },
          cache: "no-store",
        })
          .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
          .then((x) => {
            if (x.ok && x.d?.user?.role === "admin") return;
            router.replace("/maintenance");
          })
          .catch(() => router.replace("/maintenance"));
      })
      .catch(() => {});
  }, [pathname, router]);

  const isMaintenanceRoute = pathname === "/maintenance";
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

  useEffect(() => {
    if (isMaintenanceRoute || isAdminRoute) {
      detachWebSocket(publicWsRef.current);
      publicWsRef.current = null;
      return;
    }
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(buildAbPublicWebSocketUrl("public_raffle_feed"));
    } catch {
      return;
    }
    publicWsRef.current = ws;
    ws.onmessage = (evt) => {
      let msg: { type?: string; maintenance?: boolean; site_online_count?: number };
      try {
        msg = JSON.parse(String(evt.data)) as { type?: string; maintenance?: boolean; site_online_count?: number };
      } catch {
        return;
      }
      if (
        (msg.type === "site_online_updated" || msg.type === "ready") &&
        typeof msg.site_online_count === "number"
      ) {
        try {
          window.dispatchEvent(new CustomEvent("ab-site-online", { detail: { count: msg.site_online_count } }));
        } catch {
          /* ignore */
        }
        return;
      }
      if (msg.type !== "site_maintenance_updated" || !msg.maintenance) return;
      const s = loadAbSession();
      if (s?.role === "admin") return;
      try {
        routerRef.current.replace("/maintenance");
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (publicWsRef.current === ws) publicWsRef.current = null;
    };
    return () => {
      detachWebSocket(ws);
      if (publicWsRef.current === ws) publicWsRef.current = null;
    };
  }, [isMaintenanceRoute, isAdminRoute]);

  useEffect(() => {
    if (!session?.token || !authVerified || isAdminRoute) return;
    const token = session.token;
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;
    const connect = () => {
      const wsUrl = buildAbWebSocketUrl(token);
      if (!wsUrl) return;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        return;
      }
      ws.onmessage = (ev) => {
        let detail: unknown;
        try {
          detail = JSON.parse(String(ev.data || "{}"));
        } catch {
          return;
        }
        const msg = detail as {
          type?: string;
          free_count?: number;
          raffle_id?: number;
          raffle_title?: string;
        };
        if (msg.type === "raffle_free_tickets_reminder") {
          const free = Math.max(0, Math.floor(Number(msg.free_count) || 0));
          const rid = Math.floor(Number(msg.raffle_id) || 0);
          if (free > 0 && rid > 0) {
            const push = formatRaffleFreeTicketsReminderPush(free, msg.raffle_title);
            const ttl = Math.max(60_000, RAFFLE_FREE_TICKETS_PUSH_INTERVAL_MS - 120_000);
            showAbBrowserNotification(push.title, push.body, `push_free_tickets_${rid}`, ttl);
          }
        }
        try {
          window.dispatchEvent(new CustomEvent(AB_USER_WS_EVENT, { detail }));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        retryTimer = window.setTimeout(connect, 2500) as unknown as number;
      };
    };
    connect();
    return () => {
      if (retryTimer) window.clearTimeout(retryTimer);
      detachWebSocket(ws);
    };
  }, [session?.token, authVerified, isAdminRoute]);

  const setSessionFromLogin = useCallback((s: AbSession) => {
    saveAbSession(s);
    setSession(s);
    setAuthVerified(true);
  }, []);

  const logout = useCallback(async () => {
    const s = loadAbSession();
    if (s?.token) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${s.token}` },
        });
      } catch {
        /* ignore */
      }
    }
    clearAbSession();
    setSession(null);
    setAuthVerified(false);
    router.push("/");
  }, [router]);

  const value = useMemo(
    () => ({
      session,
      authVerified,
      authCheckInFlight,
      setSessionFromLogin,
      logout,
      verifySession,
      toast,
    }),
    [session, authVerified, authCheckInFlight, setSessionFromLogin, logout, verifySession, toast],
  );

  return <AbSessionContext.Provider value={value}>{children}</AbSessionContext.Provider>;
}

export function useAbSession(): AbSessionContextValue {
  const v = useContext(AbSessionContext);
  if (!v) throw new Error("useAbSession must be used within AbSessionProvider");
  return v;
}
