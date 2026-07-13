export const AB_AUTH_STORAGE_KEY = "ab_auth_v2";
export const AB_SESS_COOKIE = "ab_sess";
/** Short SSO token only — full JSON in cookie breaks Beeline/nginx (403, header too large). */
export const AB_TOKEN_COOKIE = "ab_tok";
const AUTH_COOKIE_MAX_AGE = 31536000;

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

/** Shared SSO for andreybolotov.ru + my.andreybolotov.ru (and localhost without Domain). */
function cookieDomainAttr(): string {
  if (typeof location === "undefined") return "";
  const h = location.hostname;
  if (h === "andreybolotov.ru" || h.endsWith(".andreybolotov.ru")) {
    return "; Domain=.andreybolotov.ru";
  }
  return "";
}

function cookieSecureAttr(): string {
  return typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
}

function cookieBaseAttrs(maxAge: number): string {
  return `path=/; max-age=${maxAge}; SameSite=Lax${cookieSecureAttr()}${cookieDomainAttr()}`;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const parts = document.cookie.split(";");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!.trim();
    if (p.startsWith(prefix)) {
      try {
        return decodeURIComponent(p.slice(prefix.length));
      } catch {
        return p.slice(prefix.length);
      }
    }
  }
  return null;
}

function writeCookie(name: string, value: string, maxAge: number): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; ${cookieBaseAttrs(maxAge)}`;
}

function deleteCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; path=/; max-age=0${cookieDomainAttr()}`;
  document.cookie = `${name}=; path=/; max-age=0`;
}

function parseSessionRaw(raw: string | null): AbSession | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<AbSession>;
    if (j && j.token && j.phone) return j as AbSession;
    return null;
  } catch {
    return null;
  }
}

/** Drop legacy fat ab_auth_v2 cookie (full JSON) that caused CDN 403. */
function clearLegacyAuthCookie(): void {
  deleteCookie(AB_AUTH_STORAGE_KEY);
}

export function loadAbSession(): AbSession | null {
  if (typeof window === "undefined") return null;
  try {
    const fromLs = parseSessionRaw(localStorage.getItem(AB_AUTH_STORAGE_KEY));
    const tok = String(readCookie(AB_TOKEN_COOKIE) || "").trim();

    if (fromLs?.token) {
      // Keep SSO cookie in sync; never put full JSON in Cookie header
      if (tok !== fromLs.token) {
        writeCookie(AB_TOKEN_COOKIE, fromLs.token, AUTH_COOKIE_MAX_AGE);
        writeCookie(AB_SESS_COOKIE, "1", AUTH_COOKIE_MAX_AGE);
      }
      clearLegacyAuthCookie();
      return fromLs;
    }

    if (tok) {
      clearLegacyAuthCookie();
      // phone/role hydrate via /api/auth/me
      return { token: tok, phone: "" };
    }

    // One-shot migrate: old fat cookie → token cookie + localStorage
    const legacy = parseSessionRaw(readCookie(AB_AUTH_STORAGE_KEY));
    if (legacy?.token) {
      try {
        localStorage.setItem(AB_AUTH_STORAGE_KEY, JSON.stringify(legacy));
      } catch {
        /* ignore */
      }
      writeCookie(AB_TOKEN_COOKIE, legacy.token, AUTH_COOKIE_MAX_AGE);
      writeCookie(AB_SESS_COOKIE, "1", AUTH_COOKIE_MAX_AGE);
      clearLegacyAuthCookie();
      return legacy;
    }

    return null;
  } catch {
    return null;
  }
}

export function saveAbSession(data: AbSession): void {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(data);
  try {
    localStorage.setItem(AB_AUTH_STORAGE_KEY, raw);
  } catch {
    /* ignore */
  }
  try {
    const token = String(data.token || "").trim();
    if (token) {
      writeCookie(AB_TOKEN_COOKIE, token, AUTH_COOKIE_MAX_AGE);
      writeCookie(AB_SESS_COOKIE, "1", AUTH_COOKIE_MAX_AGE);
    }
    clearLegacyAuthCookie();
  } catch {
    /* ignore */
  }
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
  deleteCookie(AB_TOKEN_COOKIE);
  deleteCookie(AB_SESS_COOKIE);
  clearLegacyAuthCookie();
}
