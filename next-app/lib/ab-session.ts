export const AB_AUTH_STORAGE_KEY = "ab_auth_v2";

export type AbSession = {
  token: string;
  phone: string;
  /** Числовой id аккаунта в БД (для поддержки и админки) */
  id?: number;
  name?: string;
  email?: string;
  locality?: string;
  role?: string;
  blocked?: boolean;
};

export function loadAbSession(): AbSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AB_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<AbSession>;
    if (j && j.token && j.phone) return j as AbSession;
    return null;
  } catch {
    return null;
  }
}

export function saveAbSession(data: AbSession): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AB_AUTH_STORAGE_KEY, JSON.stringify(data));
}

export function clearAbSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AB_AUTH_STORAGE_KEY);
  try {
    localStorage.removeItem("ab_auth_demo");
  } catch {
    /* ignore */
  }
}
