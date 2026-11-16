/** Shared CORS allowlist + security headers for Hono/Fastify entrypoints. */

function splitOrigins(raw: string): string[] {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function allowedCorsOrigins(): string[] {
  const fromEnv = splitOrigins(
    process.env.CORS_ORIGINS ||
      [process.env.APP_PUBLIC_URL, process.env.SITE_URL, process.env.NEXT_PUBLIC_SITE_URL]
        .filter(Boolean)
        .join(","),
  );
  const defaults = [
    "https://andreybolotov.ru",
    "https://www.andreybolotov.ru",
    "https://my.andreybolotov.ru",
  ];
  const out = new Set<string>([...defaults, ...fromEnv]);
  if (process.env.NODE_ENV !== "production") {
    for (const o of [
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "http://127.0.0.1:4321",
      "http://localhost:4321",
      "http://127.0.0.1:8787",
      "http://localhost:8787",
    ]) {
      out.add(o);
    }
  }
  return [...out];
}

export function isCorsOriginAllowed(origin: string | null | undefined): boolean {
  const o = String(origin || "").trim().replace(/\/$/, "");
  if (!o) return false;
  return allowedCorsOrigins().includes(o);
}

/** Rate limit on unless explicitly disabled with AB_ENABLE_RATE_LIMIT=0 */
export function isRateLimitEnabled(): boolean {
  return process.env.AB_ENABLE_RATE_LIMIT !== "0";
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
};

export function applySecurityHeaders(setHeader: (name: string, value: string) => void, opts?: { hsts?: boolean }) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) setHeader(k, v);
  if (opts?.hsts !== false && process.env.NODE_ENV === "production") {
    setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}
