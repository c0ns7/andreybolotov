import { clearAbSession, loadAbSession } from "./ab-session";

export function abAuthHeaders(): Record<string, string> {
  const s = loadAbSession();
  if (!s?.token) return {};
  return { Authorization: `Bearer ${s.token}` };
}

export class AbApiError extends Error {
  status: number;
  code?: string;
  accountBlocked?: boolean;
  maintenance?: boolean;

  constructor(message: string, status: number, opts?: { code?: string; accountBlocked?: boolean; maintenance?: boolean }) {
    super(message);
    this.status = status;
    this.code = opts?.code;
    this.accountBlocked = opts?.accountBlocked;
    this.maintenance = opts?.maintenance;
  }
}

export async function abApiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const auth = abAuthHeaders() as Record<string, string>;
  const hadAuth = Boolean(auth.Authorization);
  if (auth.Authorization) headers.set("Authorization", auth.Authorization);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers, cache: init.cache ?? "no-store" });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 403 && data.code === "account_blocked") {
      throw new AbApiError(String(data.error || "Аккаунт заблокирован"), 403, { code: "account_blocked", accountBlocked: true });
    }
    if (res.status === 503 && data.code === "maintenance") {
      throw new AbApiError(String(data.error || "Технические работы"), 503, { code: "maintenance", maintenance: true });
    }
    if (res.status === 401 && hadAuth) {
      clearAbSession();
    }
    const msg =
      res.status === 401 && hadAuth
        ? "SESSION_EXPIRED"
        : String((data.error as string) || (data.message as string) || `Ошибка ${res.status}`);
    throw new AbApiError(msg, res.status, { code: data.code as string | undefined });
  }
  return data as T;
}
