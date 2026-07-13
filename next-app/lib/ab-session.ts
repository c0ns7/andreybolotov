export const AB_AUTH_STORAGE_KEY = "ab_auth_v2";
export const AB_SESS_COOKIE = "ab_sess";
export const AB_TOKEN_COOKIE = "ab_tok";

export type AbSession = {
  token: string;
  phone: string;
  /** Числовой id аккаунта в БД (для поддержки и админки) */
  id?: number;
  name?: string;
  locality?: string;
  role?: string;
  blocked?: boolean;
};

/**
 * Beeline CDN (my.andreybolotov.ru) returns 403 nginx when the request
 * includes Cookie (even a small ab_tok). Shared Domain cookies break HTML
 * after login. Session lives in localStorage only; we actively clear auth cookies.
 */
function cookieDomainAttr(): string {
  if (typeof location === "undefined") return "";
  const h = location.hostname;
  if (h === "andreybolotov.ru" || h.endsWith(".andreybolotov.ru")) {
    return "; Domain=.andreybolotov.ru";
  }
  return "";
}

function deleteCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; path=/; max-age=0${cookieDomainAttr()}`;
  document.cookie = `${name}=; path=/; max-age=0`;
}

/** Remove auth cookies that cause CDN 403 on my. */
export function clearAbAuthCookies(): void {
  if (typeof document === "undefined") return;
  deleteCookie(AB_AUTH_STORAGE_KEY);
  deleteCookie(AB_TOKEN_COOKIE);
  deleteCookie(AB_SESS_COOKIE);
}

function parseSessionRaw(raw: string | null): AbSession | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<AbSession>;
    if (j && j.token && j.phone) return j as AbSession;
    // token-only (hydrate via /api/auth/me)
    if (j && j.token) return { token: String(j.token), phone: String(j.phone || "") };
    return null;
  } catch {
    return null;
  }
}

let cookiesClearedThisPage = false;

function ensureAuthCookiesCleared(): void {
  if (cookiesClearedThisPage || typeof window === "undefined") return;
  cookiesClearedThisPage = true;
  clearAbAuthCookies();
}

export function loadAbSession(): AbSession | null {
  if (typeof window === "undefined") return null;
  try {
    ensureAuthCookiesCleared();
    return parseSessionRaw(localStorage.getItem(AB_AUTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveAbSession(data: AbSession): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AB_AUTH_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
  // Never write auth cookies — Beeline CDN 403 with Cookie header
  clearAbAuthCookies();
}

export function clearAbSession(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(AB_AUTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem("ab_auth_demo");
  } catch {
    /* ignore */
  }
  clearAbAuthCookies();
}
