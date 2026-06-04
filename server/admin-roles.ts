/** Роли персонала в админ-панели и доступ к разделам. */

export type AdminArea =
  | "support"
  | "users"
  | "raffles"
  | "payments"
  | "prizes"
  | "settings"
  | "music"
  | "stats"
  | "blog";

export const STAFF_ROLE_VALUES = [
  "owner",
  "developer",
  "moderator",
  "support",
  "financier",
  "admin",
] as const;

export type StaffRole = (typeof STAFF_ROLE_VALUES)[number];

const FULL_ACCESS_ROLES = new Set<StaffRole>(["owner", "developer", "moderator", "admin"]);

const ROLE_LABELS: Record<string, string> = {
  owner: "Владелец",
  developer: "Разработчик",
  moderator: "Модератор",
  support: "Саппорт",
  financier: "Финансист",
  admin: "Владелец",
  user: "Пользователь",
};

/** Старые записи role=admin считаем владельцем. */
export function normalizeStaffRole(role: string | null | undefined): string {
  const r = String(role ?? "user").trim().toLowerCase();
  if (r === "admin") return "owner";
  return r;
}

export function isStaffRole(role: string | null | undefined): boolean {
  const r = normalizeStaffRole(role);
  return (
    r === "owner" ||
    r === "developer" ||
    r === "moderator" ||
    r === "support" ||
    r === "financier"
  );
}

/** Владелец, разработчик, модератор — полный доступ. */
export function isFullAccessStaff(role: string | null | undefined): boolean {
  const r = normalizeStaffRole(role) as StaffRole;
  return FULL_ACCESS_ROLES.has(r);
}

export function staffRoleLabel(role: string | null | undefined): string {
  const r = normalizeStaffRole(role);
  return ROLE_LABELS[r] ?? ROLE_LABELS.user ?? "Пользователь";
}

export function staffHasArea(role: string | null | undefined, area: AdminArea): boolean {
  const r = normalizeStaffRole(role);
  if (!isStaffRole(r)) return false;
  if (isFullAccessStaff(r)) return true;
  if (r === "support") {
    return area === "support" || area === "payments" || area === "raffles" || area === "music";
  }
  if (r === "financier") {
    return area === "support" || area === "payments" || area === "music";
  }
  return false;
}

export function staffAdminAreas(role: string | null | undefined): AdminArea[] {
  const all: AdminArea[] = [
    "support",
    "users",
    "raffles",
    "payments",
    "prizes",
    "settings",
    "music",
    "stats",
    "blog",
  ];
  return all.filter((a) => staffHasArea(role, a));
}

/** Может назначать роли персонала (не только user). */
export function canAssignStaffRoles(actorRole: string | null | undefined): boolean {
  const r = normalizeStaffRole(actorRole);
  return r === "owner" || r === "developer" || r === "moderator";
}

export function parseStaffRoleInput(raw: unknown): string | null {
  const r = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (r === "user") return "user";
  if (
    r === "owner" ||
    r === "developer" ||
    r === "moderator" ||
    r === "support" ||
    r === "financier" ||
    r === "admin"
  ) {
    return normalizeStaffRole(r);
  }
  return null;
}

/** Раздел API админки по пути (относительно /api/admin). */
export function resolveAdminArea(path: string, method: string): AdminArea {
  const p = (path.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const m = method.toUpperCase();

  if (p === "/chat/upload" || p === "/typing" || p === "/broadcast-max-chat-invite") {
    return "support";
  }
  if (/^\/users\/[^/]+\/messages/.test(p)) return "support";
  if (/^\/users\/[^/]+\/typing$/.test(p)) return "support";
  if (/^\/users\/[^/]+\/latest-raffle-tickets$/.test(p)) return "support";
  if (p === "/users" && m === "GET") return "support";

  if (p === "/users/all" || p === "/stats/users") return "users";
  if (p.startsWith("/users/")) return "users";

  if (p.startsWith("/raffle-payments") || p.startsWith("/raffle-orders")) return "payments";
  if (p.startsWith("/raffles")) return "raffles";
  if (p.startsWith("/prizes")) return "prizes";
  if (p.startsWith("/settings")) return "settings";
  if (p.startsWith("/music")) return "music";
  if (p.startsWith("/blog")) return "blog";

  return "stats";
}
