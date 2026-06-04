export type AdminArea =
  | "home"
  | "support"
  | "users"
  | "raffles"
  | "payments"
  | "prizes"
  | "settings"
  | "music"
  | "stats"
  | "blog";

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

export function isFullAccessStaff(role: string | null | undefined): boolean {
  const r = normalizeStaffRole(role);
  return r === "owner" || r === "developer" || r === "moderator";
}

export function staffHasArea(role: string | null | undefined, area: AdminArea): boolean {
  const r = normalizeStaffRole(role);
  if (!isStaffRole(r)) return false;
  if (area === "home") return true;
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
    "home",
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
