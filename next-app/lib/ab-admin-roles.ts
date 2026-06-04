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
