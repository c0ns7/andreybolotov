(function () {
  "use strict";

  var BAND = 500;
  /** Макс. чипов в одном диапазоне (иначе DOM раздувается) */
  var MAX_CHIPS_PER_BAND = 2000;
  var root;
  var statusEl;
  var bandsEl;
  var titleEl;
  var metaEl;
  var currentRaffleId = null;
  var inFlight = false;
  var queued = false;
  var ws;
  var wsReconnectTimer = null;
  var refetchDebounceTimer = null;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function buildWsUrl() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + "/ws?scope=public_raffle_feed";
  }

  function scheduleRefetch() {
    if (refetchDebounceTimer) clearTimeout(refetchDebounceTimer);
    refetchDebounceTimer = setTimeout(function () {
      refetchDebounceTimer = null;
      loadData();
    }, 280);
  }

  function renderBands(ticketCount, freeList) {
    if (!bandsEl) return;
    if (!ticketCount || ticketCount < 1) {
      bandsEl.innerHTML = "";
      return;
    }
    var freeSet = new Set(freeList);
    var html = "";
    for (var start = 1; start <= ticketCount; start += BAND) {
      var end = Math.min(start + BAND - 1, ticketCount);
      var nums = [];
      for (var n = start; n <= end; n++) {
        if (freeSet.has(n)) nums.push(n);
      }
      html +=
        '<section class="numbers-band" aria-labelledby="numbers-band-h-' +
        start +
        '">' +
        '<div class="numbers-band__head">' +
        '<h2 class="numbers-band__title" id="numbers-band-h-' +
        start +
        '">Номерки ' +
        start +
        "–" +
        end +
        "</h2>" +
        '<span class="numbers-band__stat">Свободно в диапазоне: <strong>' +
        nums.length +
        "</strong></span>" +
        "</div>";
      if (!nums.length) {
        html += '<p class="numbers-band__empty">В этом диапазоне нет свободных номерков.</p>';
      } else {
        var show = nums;
        var hidden = 0;
        if (nums.length > MAX_CHIPS_PER_BAND) {
          show = nums.slice(0, MAX_CHIPS_PER_BAND);
          hidden = nums.length - MAX_CHIPS_PER_BAND;
        }
        html += '<div class="numbers-chips" role="list">';
        for (var i = 0; i < show.length; i++) {
          html +=
            '<span class="numbers-chip" role="listitem">№' + esc(String(show[i])) + "</span>";
        }
        html += "</div>";
        if (hidden > 0) {
          html +=
            '<p class="numbers-band__trunc">Показаны первые ' +
            MAX_CHIPS_PER_BAND +
            " из " +
            nums.length +
            " — остальные тоже свободны.</p>";
        }
      }
      html += "</section>";
    }
    bandsEl.innerHTML = html;
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = "numbers-status" + (kind ? " numbers-status--" + kind : "");
  }

  function loadData() {
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    setStatus("Загрузка…", "muted");
    fetch("/api/public/latest-raffle/free-numbers", { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.error || j.message || "Ошибка " + r.status);
          return j;
        });
      })
      .then(function (data) {
        var r = data.raffle;
        currentRaffleId = data.raffle_id != null ? Number(data.raffle_id) : null;
        if (!r || !data.ticket_count) {
          if (titleEl) titleEl.textContent = "Свободные номерки";
          if (metaEl) metaEl.textContent = "Сейчас нет действующей открытой акции на сайте.";
          renderBands(0, []);
          setStatus("Обновлено: " + new Date().toLocaleString("ru-RU"), "ok");
          return;
        }
        if (titleEl) titleEl.textContent = "Свободные номерки — " + String(r.title || "акция");
        if (metaEl) {
          metaEl.textContent =
            "Акция №" +
            String(data.raffle_id) +
            " · всего номерков: " +
            String(data.ticket_count) +
            " · свободно: " +
            String(data.free_count != null ? data.free_count : (data.free_numbers || []).length);
        }
        renderBands(Number(data.ticket_count) || 0, data.free_numbers || []);
        setStatus("Обновлено: " + new Date().toLocaleString("ru-RU"), "ok");
      })
      .catch(function (e) {
        setStatus(String(e.message || e), "err");
      })
      .finally(function () {
        inFlight = false;
        if (queued) {
          queued = false;
          loadData();
        }
      });
  }

  function onWsMessage(ev) {
    var msg;
    try {
      msg = JSON.parse(String(ev.data || "{}"));
    } catch (_) {
      return;
    }
    if (msg.type === "raffles_feed_updated") {
      scheduleRefetch();
      return;
    }
    if (msg.type === "raffle_grid_updated") {
      var rid = Number(msg.raffle_id);
      if (currentRaffleId != null && Number.isFinite(rid) && rid === currentRaffleId) {
        scheduleRefetch();
      }
      return;
    }
  }

  function connectWs() {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    try {
      ws = new WebSocket(buildWsUrl());
    } catch (_) {
      wsReconnectTimer = setTimeout(connectWs, 4000);
      return;
    }
    ws.onmessage = onWsMessage;
    ws.onclose = function () {
      wsReconnectTimer = setTimeout(connectWs, 3500);
    };
    ws.onerror = function () {
      try {
        ws.close();
      } catch (_) {}
    };
  }

  function initNumbersPage() {
    root = document.getElementById("numbers-page");
    if (!root) return;
    statusEl = document.getElementById("numbers-status");
    bandsEl = document.getElementById("numbers-bands");
    titleEl = document.getElementById("numbers-page-title");
    metaEl = document.getElementById("numbers-page-meta");
    loadData();
    connectWs();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNumbersPage);
  } else {
    initNumbersPage();
  }
})();
