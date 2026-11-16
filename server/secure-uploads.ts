import { createHmac, timingSafeEqual } from "node:crypto";

const SENSITIVE_UPLOAD_PREFIXES = ["/uploads/receipts/", "/uploads/chat/"] as const;
const DEFAULT_TTL_SEC = 60 * 60; // 1 hour

function signingSecret(): string {
  const s =
    process.env.UPLOAD_SIGNING_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.AB_INTERNAL_SECRET?.trim() ||
    "";
  return s || "ab-dev-upload-signing-change-me";
}

export function isSensitiveUploadPath(pathname: string): boolean {
  const p = String(pathname || "").split("?")[0] || "";
  return SENSITIVE_UPLOAD_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** Путь без query (для хранения в БД и проверки прав). */
export function canonicalUploadPath(rawUrl: string | null | undefined): string {
  return String(rawUrl || "").trim().split("?")[0] || "";
}

function hmacHex(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Подписывает путь вида /uploads/receipts/file.pdf (без query). */
export function signUploadPath(pathname: string, ttlSec = DEFAULT_TTL_SEC): string {
  const pathOnly = String(pathname || "").split("?")[0] || "";
  if (!isSensitiveUploadPath(pathOnly)) return pathOnly;
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(ttlSec));
  const sig = hmacHex(`${pathOnly}.${exp}`);
  return `${pathOnly}?exp=${exp}&sig=${sig}`;
}

export function signUploadUrlIfNeeded(rawUrl: string | null | undefined, ttlSec = DEFAULT_TTL_SEC): string | null {
  const url = String(rawUrl ?? "").trim();
  if (!url) return null;
  if (!isSensitiveUploadPath(url)) return url;
  const pathOnly = url.split("?")[0] || url;
  return signUploadPath(pathOnly, ttlSec);
}

export function verifySignedUploadPath(
  pathname: string,
  expRaw: string | null | undefined,
  sigRaw: string | null | undefined,
): boolean {
  const pathOnly = String(pathname || "").split("?")[0] || "";
  if (!isSensitiveUploadPath(pathOnly)) return true;
  const exp = Math.floor(Number(expRaw));
  const sig = String(sigRaw || "").trim().toLowerCase();
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  if (!/^[a-f0-9]{64}$/.test(sig)) return false;
  const expected = hmacHex(`${pathOnly}.${exp}`);
  return safeEqualHex(sig, expected);
}

export function parseUploadRelFromUrl(rawUrl: string): { subdir: string; fileName: string } | null {
  const pathOnly = String(rawUrl || "").split("?")[0] || "";
  const m = pathOnly.match(/^\/uploads\/(receipts|chat|blog|raffles)\/([a-zA-Z0-9._-]+)$/);
  if (!m) return null;
  return { subdir: m[1]!, fileName: m[2]! };
}
