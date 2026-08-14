(function () {
  "use strict";

  /** @type {null | {
   *   exported_at?: string,
   *   raffle?: { id?: number, title?: string, status?: string, ticket_count?: number },
   *   stats?: { participants_count?: number, tickets_count?: number, paid_tickets_count?: number, bonus_tickets_count?: number },
   *   participants?: Array<{
   *     user_id?: number,
   *     name?: string,
   *     phone?: string,
   *     locality?: string,
   *     email?: string,
   *     ticket_count?: number,
   *     paid_ticket_count?: number,
   *     bonus_ticket_count?: number,
   *     tickets?: Array<{ number?: number, is_bonus?: boolean, bonus_promo_kind?: string|null }>
   *   }>
   * }} */
  var data = null;
  var searchTimer = null;

  var emptyState = document.getElementById("empty-state");
  var workspace = document.getElementById("workspace");
  var raffleTitle = document.getElementById("raffle-title");
  var raffleSub = document.getElementById("raffle-sub");
  var statsEl = document.getElementById("stats");
  var searchInput = document.getElementById("search-input");
  var searchStatus = document.getElementById("search-status");
  var resultsEl = document.getElementById("results");
  var fileInput = document.getElementById("file-input");
  var fileInputEmpty = document.getElementById("file-input-empty");

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function digitsOnly(s) {
    return String(s || "").replace(/\D+/g, "");
  }

  function normalizeQuery(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function highlightText(text, query) {
    var src = String(text || "");
    if (!query) return esc(src);
    var lower = src.toLowerCase();
    var idx = lower.indexOf(query);
    if (idx < 0) return esc(src);
    return (
      esc(src.slice(0, idx)) +
      "<mark>" +
      esc(src.slice(idx, idx + query.length)) +
      "</mark>" +
      esc(src.slice(idx + query.length))
    );
  }

  function highlightPhone(phone, queryDigits) {
    var src = String(phone || "");
    if (!queryDigits || queryDigits.length < 3) return esc(src);
    var dig = digitsOnly(src);
    var idx = dig.indexOf(queryDigits);
    if (idx < 0) return esc(src);
    // Approximate highlight on full phone string by marking whole phone when digits match.
    return "<mark>" + esc(src) + "</mark>";
  }

  function parsePayload(raw) {
    var json = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!json || typeof json !== "object") throw new Error("Некорректный JSON");
    if (!Array.isArray(json.participants)) throw new Error("В файле нет массива participants");
    json.participants = json.participants.map(function (p) {
      var tickets = Array.isArray(p.tickets) ? p.tickets : [];
      return {
        user_id: Number(p.user_id) || 0,
        name: String(p.name || "").trim(),
        phone: String(p.phone || "").trim(),
        locality: String(p.locality || "").trim(),
        email: String(p.email || "").trim(),
        ticket_count: Number(p.ticket_count) || tickets.length,
        paid_ticket_count: Number(p.paid_ticket_count) || 0,
        bonus_ticket_count: Number(p.bonus_ticket_count) || 0,
        tickets: tickets
          .map(function (t) {
            return {
              number: Math.floor(Number(t && t.number) || 0),
              is_bonus: !!(t && t.is_bonus),
              bonus_promo_kind: t && t.bonus_promo_kind ? String(t.bonus_promo_kind) : null,
            };
          })
          .filter(function (t) {
            return t.number > 0;
          }),
        _nameLower: String(p.name || "")
          .trim()
          .toLowerCase(),
        _localityLower: String(p.locality || "")
          .trim()
          .toLowerCase(),
        _phoneDigits: digitsOnly(p.phone || ""),
        _ticketSet: tickets
          .map(function (t) {
            return String(Math.floor(Number(t && t.number) || 0));
          })
          .filter(Boolean),
      };
    });
    return json;
  }

  function setLoaded(payload, fileName) {
    data = payload;
    emptyState.hidden = true;
    workspace.hidden = false;
    var title = (payload.raffle && payload.raffle.title) || "Акция";
    var rid = payload.raffle && payload.raffle.id != null ? String(payload.raffle.id) : "—";
    raffleTitle.textContent = title;
    var when = payload.exported_at ? String(payload.exported_at).replace("T", " ").replace("Z", " UTC") : "";
    raffleSub.textContent =
      "ID " +
      rid +
      (fileName ? " · " + fileName : "") +
      (when ? " · экспорт " + when : "");

    var st = payload.stats || {};
    var participantsCount =
      st.participants_count != null ? st.participants_count : payload.participants.length;
    var ticketsCount =
      st.tickets_count != null
        ? st.tickets_count
        : payload.participants.reduce(function (sum, p) {
            return sum + (p.tickets ? p.tickets.length : 0);
          }, 0);
    var paidCount = st.paid_tickets_count != null ? st.paid_tickets_count : "—";
    var bonusCount = st.bonus_tickets_count != null ? st.bonus_tickets_count : "—";
    statsEl.innerHTML =
      '<div class="chip"><span>Участников</span> ' +
      esc(String(participantsCount)) +
      "</div>" +
      '<div class="chip"><span>Номерков</span> ' +
      esc(String(ticketsCount)) +
      "</div>" +
      '<div class="chip"><span>Платных</span> ' +
      esc(String(paidCount)) +
      "</div>" +
      '<div class="chip"><span>Бонусных</span> ' +
      esc(String(bonusCount)) +
      "</div>";

    searchInput.value = "";
    searchInput.focus();
    renderResults("");
  }

  function matchParticipant(p, query, queryDigits) {
    if (!query) return { ok: true, ticketHits: [] };
    var ticketHits = [];
    if (queryDigits) {
      if (p._phoneDigits.indexOf(queryDigits) >= 0) {
        return { ok: true, ticketHits: ticketHits };
      }
      for (var i = 0; i < p._ticketSet.length; i++) {
        var tn = p._ticketSet[i];
        if (tn === queryDigits || tn.indexOf(queryDigits) === 0) ticketHits.push(Number(tn));
      }
      if (ticketHits.length) return { ok: true, ticketHits: ticketHits };
    }
    if (p._nameLower.indexOf(query) >= 0) return { ok: true, ticketHits: [] };
    if (p._localityLower.indexOf(query) >= 0) return { ok: true, ticketHits: [] };
    if (String(p.email || "")
      .toLowerCase()
      .indexOf(query) >= 0) {
      return { ok: true, ticketHits: [] };
    }
    return { ok: false, ticketHits: [] };
  }

  function renderResults(rawQuery) {
    if (!data) return;
    var query = normalizeQuery(rawQuery);
    var queryDigits = digitsOnly(query);
    var rows = [];
    var list = data.participants || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var m = matchParticipant(p, query, queryDigits);
      if (m.ok) rows.push({ p: p, ticketHits: m.ticketHits });
    }

    if (!rows.length) {
      resultsEl.innerHTML =
        '<div class="empty-results">Ничего не найдено по запросу «' + esc(rawQuery) + '»</div>';
      searchStatus.textContent = "0 из " + String(list.length);
      return;
    }

    searchStatus.textContent =
      (query ? "Найдено " + rows.length : "Всего " + rows.length) + " из " + String(list.length);

    var hitSetLimit = query ? 400 : 120;
    var shown = rows.slice(0, hitSetLimit);
    var html = shown
      .map(function (row) {
        var p = row.p;
        var hitTickets = {};
        for (var h = 0; h < row.ticketHits.length; h++) hitTickets[row.ticketHits[h]] = true;
        var ticketsHtml = (p.tickets || [])
          .map(function (t) {
            var cls = "ticket";
            if (t.is_bonus) cls += " is-bonus";
            if (hitTickets[t.number]) cls += " is-match";
            return (
              '<span class="' +
              cls +
              '" title="' +
              (t.is_bonus ? "Бонусный номерок" : "Платный номерок") +
              '"><' +
              esc(String(t.number)) +
              (t.is_bonus ? "★" : "") +
              "></span>"
            );
          })
          .join("");
        return (
          '<article class="card' +
          (query ? " is-hit" : "") +
          '">' +
          '<div class="card__head">' +
          '<h3 class="card__name">' +
          (p.name ? highlightText(p.name, query) : "<em>Без имени</em>") +
          "</h3>" +
          '<div class="card__count">' +
          esc(String(p.tickets.length)) +
          " ном.</div>" +
          "</div>" +
          '<div class="card__meta">' +
          "<div>Тел: <strong>" +
          (p.phone ? highlightPhone(p.phone, queryDigits) : "—") +
          "</strong></div>" +
          "<div>Откуда: <strong>" +
          (p.locality ? highlightText(p.locality, query) : "—") +
          "</strong></div>" +
          (p.email ? "<div>Email: <strong>" + esc(p.email) + "</strong></div>" : "") +
          "</div>" +
          '<div class="tickets">' +
          (ticketsHtml || '<span class="empty-results">Нет номерков</span>') +
          "</div>" +
          "</article>"
        );
      })
      .join("");

    if (rows.length > shown.length) {
      html +=
        '<div class="empty-results">Показаны первые ' +
        String(shown.length) +
        " из " +
        String(rows.length) +
        ". Уточните поиск.</div>";
    }
    resultsEl.innerHTML = html;
  }

  function onFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var payload = parsePayload(String(reader.result || ""));
        setLoaded(payload, file.name);
      } catch (err) {
        alert((err && err.message) || "Не удалось прочитать JSON");
      }
    };
    reader.onerror = function () {
      alert("Ошибка чтения файла");
    };
    reader.readAsText(file, "utf-8");
  }

  function bindFileInput(el) {
    if (!el) return;
    el.addEventListener("change", function () {
      var f = el.files && el.files[0];
      onFile(f);
      el.value = "";
    });
  }

  bindFileInput(fileInput);
  bindFileInput(fileInputEmpty);

  searchInput.addEventListener("input", function () {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      renderResults(searchInput.value);
    }, 80);
  });

  // Drag & drop anywhere
  ["dragenter", "dragover"].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      e.preventDefault();
    });
  });
  window.addEventListener("drop", function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });
})();
