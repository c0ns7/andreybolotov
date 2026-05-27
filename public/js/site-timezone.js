(function (global) {
  "use strict";

  var SITE_TIMEZONE = "Asia/Chita";
  var SITE_TIMEZONE_LABEL = "Агинское время (UTC+9)";
  var MOSCOW_TIMEZONE = "Europe/Moscow";
  var LOCAL_DT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

  function parseSiteDateTimeLocalToUtcMs(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    var m = LOCAL_DT_RE.exec(s);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]) - 1;
    var d = Number(m[3]);
    var h = Number(m[4]);
    var mi = Number(m[5]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d) || !Number.isFinite(h) || !Number.isFinite(mi)) {
      return null;
    }
    var utc = Date.UTC(y, mo, d, h - 9, mi);
    if (!Number.isFinite(utc) || utc <= 0) return null;
    return Math.floor(utc);
  }

  function formatSiteDateTimeLocalFromUtcMs(ms) {
    var n = Math.floor(Number(ms));
    if (!Number.isFinite(n) || n <= 0) return "";
    try {
      var parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone: SITE_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(new Date(n));
      var get = function (type) {
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type === type) return parts[i].value;
        }
        return "";
      };
      var y = get("year");
      var mo = get("month");
      var d = get("day");
      var h = get("hour");
      var mi = get("minute");
      if (!y || !mo || !d) return "";
      return y + "-" + mo + "-" + d + "T" + h + ":" + mi;
    } catch (_) {
      return "";
    }
  }

  function formatRuInTimezone(ms, timeZone) {
    try {
      return new Date(ms).toLocaleString("ru-RU", {
        timeZone: timeZone,
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return new Date(ms).toISOString();
    }
  }

  function formatRuSiteDateTime(ms) {
    return formatRuInTimezone(ms, SITE_TIMEZONE);
  }

  function formatRuMoscowDateTime(ms) {
    return formatRuInTimezone(ms, MOSCOW_TIMEZONE);
  }

  function formatStreamCardShort(ms) {
    try {
      return new Date(ms).toLocaleString("ru-RU", {
        timeZone: SITE_TIMEZONE,
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "";
    }
  }

  global.AbSiteTimezone = {
    SITE_TIMEZONE: SITE_TIMEZONE,
    SITE_TIMEZONE_LABEL: SITE_TIMEZONE_LABEL,
    MOSCOW_TIMEZONE: MOSCOW_TIMEZONE,
    parseSiteDateTimeLocalToUtcMs: parseSiteDateTimeLocalToUtcMs,
    formatSiteDateTimeLocalFromUtcMs: formatSiteDateTimeLocalFromUtcMs,
    formatRuSiteDateTime: formatRuSiteDateTime,
    formatRuMoscowDateTime: formatRuMoscowDateTime,
    formatRuInTimezone: formatRuInTimezone,
    formatStreamCardShort: formatStreamCardShort,
  };
})(typeof window !== "undefined" ? window : globalThis);
