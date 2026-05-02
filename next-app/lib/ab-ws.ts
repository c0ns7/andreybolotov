/** Same contract as legacy `buildChatWebSocketUrl` in public/js/app.js */
export function buildAbWebSocketUrl(token: string): string {
  try {
    const fixed = typeof window !== "undefined" && (window as unknown as { __AB_WS_ORIGIN__?: string }).__AB_WS_ORIGIN__;
    if (fixed) {
      const o = String(fixed).replace(/\/$/, "");
      return o + "/ws?token=" + encodeURIComponent(token);
    }
  } catch {
    /* ignore */
  }
  const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof location !== "undefined" ? location.host : "127.0.0.1:3000";
  return proto + "//" + host + "/ws?token=" + encodeURIComponent(token);
}

export function buildAbPublicWebSocketUrl(scope: string): string {
  try {
    const fixed = typeof window !== "undefined" && (window as unknown as { __AB_WS_ORIGIN__?: string }).__AB_WS_ORIGIN__;
    if (fixed) {
      const o = String(fixed).replace(/\/$/, "");
      return o + "/ws?scope=" + encodeURIComponent(scope);
    }
  } catch {
    /* ignore */
  }
  const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof location !== "undefined" ? location.host : "127.0.0.1:3000";
  return proto + "//" + host + "/ws?scope=" + encodeURIComponent(scope);
}

/**
 * Закрывает сокет при размонтировании / смене маршрута: снимает обработчики (в т.ч. onclose с переподключением),
 * не рвёт CONNECTING так, чтобы браузер сыпал «closed before the connection is established».
 */
export function detachWebSocket(ws: WebSocket | null | undefined): void {
  if (!ws) return;
  try {
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    const state = ws.readyState;
    if (state === WebSocket.OPEN) {
      ws.close(1000, "detach");
    } else if (state === WebSocket.CONNECTING) {
      const w = ws;
      w.addEventListener(
        "open",
        () => {
          try {
            w.close(1000, "detach");
          } catch {
            /* ignore */
          }
        },
        { once: true },
      );
    }
  } catch {
    /* ignore */
  }
}
