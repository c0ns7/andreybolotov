/**
 * Beeline CDN (my.) returns 403 (X-Reason-Code: 7) for URLs that look like
 * signed tokens: bare UUID or 32-char hex. Prefix public tokens with `ab.`.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32_RE = /^[0-9a-f]{32}$/i;
const AB_PREFIX = "ab.";

function stripAbPrefix(raw: string): string {
  const s = String(raw || "").trim();
  return /^ab\./i.test(s) ? s.slice(AB_PREFIX.length) : s;
}

function dashlessHex(raw: string): string | null {
  const s = stripAbPrefix(raw);
  if (UUID_RE.test(s)) return s.replace(/-/g, "").toLowerCase();
  if (HEX32_RE.test(s)) return s.toLowerCase();
  return null;
}

function dashlessToUuid(hex: string): string {
  const x = hex.toLowerCase();
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function encodeCdnSafeToken(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return s;
  const hex = dashlessHex(s);
  if (hex) return AB_PREFIX + hex;
  return s;
}

export function decodeCdnSafeToken(raw: string): string {
  const hex = dashlessHex(raw);
  if (hex) return hex;
  return stripAbPrefix(raw);
}

export function raffleHashFromCdnSafe(raw: string): string {
  const hex = dashlessHex(raw);
  if (hex) return dashlessToUuid(hex);
  return String(raw || "").trim();
}

export function rafflePublicPath(hash: string): string {
  return "/raffle/" + encodeURIComponent(encodeCdnSafeToken(hash));
}

export function orderStatusPublicPath(token: string): string {
  return "/home/order-status?t=" + encodeURIComponent(encodeCdnSafeToken(token));
}

export function raffleHashLookupCandidates(raw: string): string[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  const out: string[] = [];
  const add = (v: string) => {
    const x = String(v || "").trim();
    if (x && !out.includes(x)) out.push(x);
  };
  add(s);
  try {
    add(decodeURIComponent(s));
  } catch {
    /* ignore */
  }
  add(raffleHashFromCdnSafe(s));
  add(decodeCdnSafeToken(s));
  const hex = dashlessHex(s);
  if (hex) {
    add(hex);
    add(dashlessToUuid(hex));
  }
  return out;
}
