"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buildAbPublicWebSocketUrl, detachWebSocket } from "../../lib/ab-ws";

type SiteStatusResponse = {
  maintenance?: boolean;
};

export default function MaintenanceStatusClient() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [hint, setHint] = useState("");

  const redirectHome = useCallback(() => {
    setHint("Перенаправляем на главную...");
    router.replace("/home");
  }, [router]);

  const checkMaintenance = useCallback(
    async (showErrors: boolean) => {
      setChecking(true);
      try {
        const res = await fetch("/api/site/status", { cache: "no-store" });
        const data = (await res.json()) as SiteStatusResponse;
        if (!data?.maintenance) {
          redirectHome();
          return;
        }
        if (showErrors) setHint("Технические работы еще идут. Попробуйте чуть позже.");
      } catch {
        if (showErrors) setHint("Не удалось проверить статус. Проверьте интернет и повторите.");
      } finally {
        setChecking(false);
      }
    },
    [redirectHome],
  );

  useEffect(() => {
    void checkMaintenance(false);
  }, [checkMaintenance]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(buildAbPublicWebSocketUrl("public_raffle_feed"));
      ws.onmessage = (evt) => {
        let msg: { type?: string; maintenance?: boolean };
        try {
          msg = JSON.parse(String(evt.data)) as { type?: string; maintenance?: boolean };
        } catch {
          return;
        }
        if (msg.type === "site_maintenance_updated" && msg.maintenance === false) {
          redirectHome();
        }
      };
    } catch {
      ws = null;
    }
    return () => {
      detachWebSocket(ws);
    };
  }, [redirectHome]);

  return (
    <div className="maintenance-card__actions">
      <button
        type="button"
        className="maintenance-retry-btn"
        onClick={() => void checkMaintenance(true)}
        disabled={checking}
      >
        {checking ? "Проверяем..." : "Попробовать еще раз"}
      </button>
      <p className="maintenance-card__hint" role="status" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}
