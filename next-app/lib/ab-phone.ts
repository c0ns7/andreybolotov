export function digitsOnly(s: string): string {
  return String(s).replace(/\D/g, "");
}

/** Нормализация в 11 цифр, начинается с 7 (как в legacy app.js). */
export function phoneToNormalized(input: string): string {
  let d = digitsOnly(input);
  if (d.startsWith("8")) d = "7" + d.slice(1);
  if (d.startsWith("9")) d = "7" + d;
  if (!d.startsWith("7")) d = "7" + d.replace(/^7+/, "");
  return d.slice(0, 11);
}

export function isValidRuMobilePhone(phone: string): boolean {
  return /^79\d{9}$/.test(phone);
}

/** Визуальный формат для инпута: +7 (XXX) XXX-XX-XX (с частичным вводом). */
export function formatRuPhoneInput(input: string): string {
  const n = phoneToNormalized(input);
  const rest = n.slice(1);
  const a = rest.slice(0, 3);
  const b = rest.slice(3, 6);
  const c = rest.slice(6, 8);
  const d = rest.slice(8, 10);
  let out = "+7";
  if (a) out += " (" + a;
  if (a.length === 3) out += ")";
  if (b) out += " " + b;
  if (c) out += "-" + c;
  if (d) out += "-" + d;
  return out;
}
