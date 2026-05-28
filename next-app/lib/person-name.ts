/** Клиентская копия server/person-name.ts — держите правила в синхроне. */
const LATIN_RE = /[A-Za-z]/;
const CYRILLIC_PART_RE = /^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?$/;
const INITIAL_DOT_RE = /[А-ЯЁA-Za-z]\s*\./;
const SINGLE_LETTER_TOKEN_RE = /^[А-ЯЁA-Za-z]$/;

export function hasPersonNameInitials(raw: string): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  if (INITIAL_DOT_RE.test(s) || /\.\s*[А-ЯЁA-Za-z]/.test(s)) return true;
  const tokens = s.split(/[\s.]+/).filter(Boolean);
  return tokens.some((t) => SINGLE_LETTER_TOKEN_RE.test(t));
}

export function capitalizeCyrillicWord(word: string): string {
  const w = String(word ?? "").trim();
  if (!w) return "";
  return w
    .split("-")
    .map((part) => {
      const lower = part.toLocaleLowerCase("ru-RU");
      if (!lower) return "";
      return lower.charAt(0).toLocaleUpperCase("ru-RU") + lower.slice(1);
    })
    .filter(Boolean)
    .join("-");
}

export function normalizePersonName(raw: string): string {
  const collapsed = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!collapsed) return "";
  return collapsed.split(" ").map(capitalizeCyrillicWord).join(" ");
}

export type PersonNameValidation =
  | { ok: true; name: string }
  | { ok: false; error: string };

export function validatePersonName(raw: string): PersonNameValidation {
  const rawTrimmed = String(raw ?? "").trim();
  if (hasPersonNameInitials(rawTrimmed)) {
    return { ok: false, error: "Инициалы не подходят — укажите фамилию и имя полностью" };
  }
  const normalized = normalizePersonName(raw);
  if (!normalized) {
    return { ok: false, error: "Укажите фамилию и имя полностью на русском языке" };
  }
  if (LATIN_RE.test(normalized)) {
    return { ok: false, error: "ФИО укажите по-русски, без латинских букв" };
  }
  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length < 2) {
    return { ok: false, error: "Нужны минимум фамилия и имя (например: Иванов Иван)" };
  }
  if (parts.length > 3) {
    return { ok: false, error: "Не больше трёх слов: фамилия, имя и отчество (по желанию)" };
  }
  for (const part of parts) {
    if (part.length < 2) {
      return { ok: false, error: "Сокращения не подходят — укажите имя и фамилию полностью" };
    }
    if (!CYRILLIC_PART_RE.test(part)) {
      return { ok: false, error: "ФИО только кириллицей, без цифр и лишних символов" };
    }
  }
  return { ok: true, name: normalized };
}

export function isPersonNameComplete(raw: string): boolean {
  return validatePersonName(raw).ok;
}
