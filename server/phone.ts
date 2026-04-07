/** Нормализация к 11 цифрам, начинается с 7 (РФ). */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 0) return null;
  let n = d;
  if (n[0] === "8") n = "7" + n.slice(1);
  if (n[0] === "9") n = "7" + n;
  if (n[0] !== "7") n = "7" + n.replace(/^7+/, "");
  n = n.slice(0, 11);
  return n.length === 11 ? n : null;
}

/** Мобильный РФ: +7 9XX … (11 цифр, после кода страны — 9). */
export function isValidRuMobile(phone: string): boolean {
  return /^79\d{9}$/.test(phone);
}
