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
