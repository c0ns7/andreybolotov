(function (global) {
  "use strict";

  var LATIN_RE = /[A-Za-z]/;
  var CYRILLIC_PART_RE = /^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?$/;
  var INITIAL_DOT_RE = /[А-ЯЁA-Za-z]\s*\./;

  function hasPersonNameInitials(raw) {
    var s = String(raw || "").trim();
    if (!s) return false;
    if (INITIAL_DOT_RE.test(s) || /\.\s*[А-ЯЁA-Za-z]/.test(s)) return true;
    var tokens = s.split(/[\s.]+/).filter(Boolean);
    for (var i = 0; i < tokens.length; i++) {
      if (/^[А-ЯЁA-Za-z]$/.test(tokens[i])) return true;
    }
    return false;
  }

  function capitalizeCyrillicWord(word) {
    var w = String(word || "").trim();
    if (!w) return "";
    return w
      .split("-")
      .map(function (part) {
        var lower = part.toLocaleLowerCase("ru-RU");
        if (!lower) return "";
        return lower.charAt(0).toLocaleUpperCase("ru-RU") + lower.slice(1);
      })
      .filter(Boolean)
      .join("-");
  }

  function normalizePersonName(raw) {
    var collapsed = String(raw || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!collapsed) return "";
    return collapsed.split(" ").map(capitalizeCyrillicWord).join(" ");
  }

  function validatePersonName(raw) {
    var rawTrimmed = String(raw || "").trim();
    if (hasPersonNameInitials(rawTrimmed)) {
      return { ok: false, error: "Инициалы не подходят — укажите фамилию и имя полностью" };
    }
    var normalized = normalizePersonName(raw);
    if (!normalized) {
      return { ok: false, error: "Укажите фамилию и имя полностью на русском языке" };
    }
    if (LATIN_RE.test(normalized)) {
      return { ok: false, error: "ФИО укажите по-русски, без латинских букв" };
    }
    var parts = normalized.split(" ").filter(Boolean);
    if (parts.length < 2) {
      return { ok: false, error: "Нужны минимум фамилия и имя (например: Иванов Иван)" };
    }
    if (parts.length > 3) {
      return { ok: false, error: "Не больше трёх слов: фамилия, имя и отчество (по желанию)" };
    }
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part.length < 2) {
        return { ok: false, error: "Сокращения не подходят — укажите имя и фамилию полностью" };
      }
      if (!CYRILLIC_PART_RE.test(part)) {
        return { ok: false, error: "ФИО только кириллицей, без цифр и лишних символов" };
      }
    }
    return { ok: true, name: normalized };
  }

  function isPersonNameComplete(raw) {
    return validatePersonName(raw).ok;
  }

  global.AbPersonName = {
    normalizePersonName: normalizePersonName,
    validatePersonName: validatePersonName,
    isPersonNameComplete: isPersonNameComplete,
    hasPersonNameInitials: hasPersonNameInitials,
  };
})(typeof window !== "undefined" ? window : globalThis);
