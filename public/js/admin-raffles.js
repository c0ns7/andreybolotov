(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";

  /** @type {Array<Record<string, unknown>>} */
  let rafflesCache = [];
  /** @type {'active' | 'hidden'} */
  let rafflesListTab = "active";
  /** @type {Array<{ticket_number:number,user_phone:string,order_status:string,is_wholesale?:boolean,user_id?:number,user_name?:string,,user_locality?:string}>} */
  let participantsCache = [];
  /** @type {Array<{wholesale_number:number,user_phone:string}>} */
  let wholesalersCache = [];
  let participantsRaffleId = null;
  let participantsActiveTab = "participants";
  let participantsWholesaleEnabled = false;
  let participantsWholesaleEveryN = 10;
  let participantsTotal = 0;
  let participantsOffset = 0;
  let participantsHasMore = false;
  let participantsLoading = false;
  let participantsReqId = 0;
  let participantsSearchTimer = null;
  const PARTICIPANTS_PAGE_SIZE = 120;
  const revealedPhones = new Set();
  let raffleSingleCheckTimer = null;
  let raffleSingleCheckReqId = 0;
  let raffleSingleTicketIsFree = false;

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const j = JSON.parse(raw);
      /** Достаточно token — phone может отсутствовать в старых сессиях; права проверяет API */
      if (j && j.token) return j;
      return null;
    } catch {
      return null;
    }
  }

  async function apiJson(path, options) {
    const opts = options || {};
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(path, {
      ...opts,
      headers,
      cache: opts.cache !== undefined ? opts.cache : "default",
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      const err = new Error(data.error || data.message || "Ошибка запроса");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function authHeaders() {
    const x = loadSession();
    if (!x || !x.token) return {};
    return { Authorization: "Bearer " + x.token };
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function wholesaleEveryNLabel() {
    var n = Math.max(1, Math.floor(Number(participantsWholesaleEveryN)) || 10);
    return String(n);
  }

  function updateWholesalersLeadText() {
    var lead = document.getElementById("raffle-wholesalers-lead");
    if (!lead) return;
    lead.textContent =
      "Номер оптовика выдаётся за каждые " +
      wholesaleEveryNLabel() +
      " закреплённых номерков (глобальная очередь по времени закрепления).";
  }

  function syncWholesaleEveryNRow() {
    var wrap = document.getElementById("raffle-wholesale-every-n-wrap");
    var toggle = document.getElementById("raffle-wholesale-enabled");
    var input = document.getElementById("raffle-wholesale-every-n");
    if (!wrap || !toggle) return;
    var on = !!toggle.checked;
    wrap.hidden = !on;
    if (input) input.disabled = !on;
  }

  function formatDateTimeLocalFromMs(ms) {
    var n = Math.floor(Number(ms));
    if (!Number.isFinite(n) || n <= 0) return "";
    var d = new Date(n);
    var pad = function (x) {
      return String(x).padStart(2, "0");
    };
    return (
      String(d.getFullYear()) +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  function parseDateTimeLocalToMs(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    var ts = Date.parse(s);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    return Math.floor(ts);
  }

  const PARTICIPANT_ICO_TRASH =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    "<polyline points=\"3 6 5 6 21 6\"></polyline>" +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' +
    "</svg>";

  const BTN_ICO = {
    users:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    edit:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
    trash:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
    pause:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>',
    lock:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
    play:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>',
    bell:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10 21a2 2 0 0 0 4 0"></path></svg>',
  };

  function bankCardRowHtml(row) {
    var id = row.id != null ? String(row.id) : "";
    var stats = "";
    if (row.stats_tickets_confirmed != null || row.stats_amount_rub_confirmed != null) {
      var t = row.stats_tickets_confirmed != null ? String(row.stats_tickets_confirmed) : "0";
      var a = row.stats_amount_rub_confirmed != null ? String(row.stats_amount_rub_confirmed) : "0";
      var u = row.usages_today_msk != null ? String(row.usages_today_msk) : "—";
      stats =
        '<p class="admin-bank-card-row__stats admin-raffle-field-hint">Учёт: подтв. номерков ' +
        esc(t) +
        " · сумма " +
        esc(a) +
        " ₽ · операций сегодня " +
        esc(u) +
        "</p>";
    }
    var daily = row.daily_max_orders != null ? Math.max(0, Math.floor(Number(row.daily_max_orders))) : 0;
    return (
      '<div class="admin-bank-card-row" data-bank-card-row role="listitem">' +
      '<input type="hidden" class="admin-bank-card-id" value="' +
      esc(id) +
      '" />' +
      '<div class="form-row-2">' +
      '<div class="form-group">' +
      "<label>Номер карты</label>" +
      '<input class="input admin-bank-card-number" type="text" maxlength="64" value="' +
      esc(String(row.card_number || "")) +
      '" placeholder="Номер карты" autocomplete="off" />' +
      "</div>" +
      '<div class="form-group">' +
      "<label>Получатель</label>" +
      '<input class="input admin-bank-card-recipient" type="text" maxlength="500" value="' +
      esc(String(row.recipient || "")) +
      '" placeholder="Кому на карту" />' +
      "</div>" +
      "</div>" +
      '<div class="form-row-2">' +
      '<div class="form-group">' +
      "<label>Макс. операций за сутки (0 — без лимита)</label>" +
      '<input class="input admin-bank-card-daily" type="number" min="0" step="1" value="' +
      esc(String(daily)) +
      '" />' +
      "</div>" +
      '<div class="form-group">' +
      "<label>Отключена до</label>" +
      '<input class="input admin-bank-card-disabled-until" type="datetime-local" step="60" value="' +
      esc(formatDateTimeLocalFromMs(row.disabled_until_ms)) +
      '" />' +
      "</div>" +
      "</div>" +
      stats +
      '<div class="admin-bank-card-row__actions">' +
      '<button type="button" class="btn btn--ghost admin-bank-card-snooze">⏸ На сутки</button> ' +
      '<button type="button" class="btn btn--ghost admin-bank-card-clear-until">Включить</button> ' +
      '<button type="button" class="btn btn--ghost admin-bank-card-remove" aria-label="Удалить">' +
      BTN_ICO.trash +
      "</button>" +
      "</div>" +
      "</div>"
    );
  }

  function syncCardPaymentScopeUi() {
    var scopeEl = document.getElementById("raffle-card-payment-scope");
    var minWrap = document.getElementById("raffle-card-payment-min-tickets-wrap");
    if (!scopeEl || !minWrap) return;
    var v = String(scopeEl.value || "").trim().toLowerCase();
    minWrap.hidden = v !== "min_order_tickets";
  }

  function renderBankCardsFromEdit(edit) {
    var wrap = document.getElementById("raffle-bank-cards-list");
    if (!wrap) return;
    var scopeEl = document.getElementById("raffle-card-payment-scope");
    var minEl = document.getElementById("raffle-card-payment-min-tickets");
    var cards = edit && Array.isArray(edit.bank_cards) ? edit.bank_cards : [];
    if (scopeEl) {
      var s = edit ? String(edit.card_payment_scope || "").toLowerCase() : "";
      if (s === "wholesale_only") scopeEl.value = "wholesale_only";
      else if (s === "min_order_tickets") scopeEl.value = "min_order_tickets";
      else scopeEl.value = "unlimited";
    }
    if (minEl) {
      var m = edit ? Math.max(1, Math.floor(Number(edit.card_payment_min_tickets)) || 2) : 2;
      minEl.value = String(m);
    }
    syncCardPaymentScopeUi();
    if (!cards.length) {
      wrap.innerHTML = '<p class="admin-raffle-field-hint">Нет карт. Нажмите «Добавить карту».</p>';
      return;
    }
    wrap.innerHTML = cards
      .map(function (c) {
        return bankCardRowHtml(c);
      })
      .join("");
  }

  function collectBankCardsPayload() {
    var wrap = document.getElementById("raffle-bank-cards-list");
    if (!wrap) return [];
    var rows = wrap.querySelectorAll("[data-bank-card-row]");
    var out = [];
    var i = 0;
    rows.forEach(function (rowEl) {
      var idEl = rowEl.querySelector(".admin-bank-card-id");
      var idRaw = idEl ? String(idEl.value || "").trim() : "";
      var idNum = idRaw ? Math.floor(Number(idRaw)) : 0;
      var card_number = String(rowEl.querySelector(".admin-bank-card-number")?.value || "").trim();
      var recipient = String(rowEl.querySelector(".admin-bank-card-recipient")?.value || "").trim();
      if (!card_number && !recipient) return;
      if (!card_number) throw new Error("У каждой карты укажите номер");
      var daily = Math.floor(Number(rowEl.querySelector(".admin-bank-card-daily")?.value || 0));
      if (!Number.isFinite(daily) || daily < 0) daily = 0;
      var du = parseDateTimeLocalToMs(rowEl.querySelector(".admin-bank-card-disabled-until")?.value || "");
      out.push({
        id: idNum > 0 ? idNum : undefined,
        card_number: card_number,
        recipient: recipient,
        daily_max_orders: daily,
        disabled_until_ms: du,
        sort_order: i++,
      });
    });
    return out;
  }

  const listEl = document.getElementById("admin-raffles-list");
  const modalForm = document.getElementById("modal-raffle-form");
  const formTitle = document.getElementById("modal-raffle-form-title");
  const form = document.getElementById("form-raffle");
  const modalParticipants = document.getElementById("modal-raffle-participants");
  const participantsSearch = document.getElementById("raffle-participants-search");
  const participantsList = document.getElementById("raffle-participants-list");

  function participantTabButtons() {
    return modalParticipants
      ? Array.from(modalParticipants.querySelectorAll(".admin-raffle-participants-tab"))
      : [];
  }
  function participantPanels() {
    return modalParticipants
      ? Array.from(modalParticipants.querySelectorAll(".admin-raffle-participants-panel"))
      : [];
  }
  const raffleSinglePhone = document.getElementById("raffle-single-phone");
  const raffleSingleTicket = document.getElementById("raffle-single-ticket");
  const raffleSingleCheck = document.getElementById("raffle-single-check");
  const raffleSingleSubmit = document.getElementById("raffle-single-submit");
  const modalBuyer = document.getElementById("modal-raffle-buyer");
  const raffleBuyerReveal = document.getElementById("raffle-buyer-reveal");
  const payTabs = Array.from(document.querySelectorAll(".admin-pay-tab"));
  const payPanels = Array.from(document.querySelectorAll(".admin-pay-panel"));

  function setPayTab(tab) {
    var current = tab === "tbank" || tab === "qr" ? tab : "sber";
    payTabs.forEach(function (btn) {
      var active = btn.getAttribute("data-pay-tab") === current;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    payPanels.forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-pay-panel") !== current;
    });
  }

  function syncPayMethodSettingsState() {
    var pairs = [
      ["raffle-sber-enabled", "raffle-sber-settings"],
      ["raffle-tbank-enabled", "raffle-tbank-settings"],
      ["raffle-qr-enabled", "raffle-qr-settings"],
    ];
    pairs.forEach(function (pair) {
      var toggle = document.getElementById(pair[0]);
      var settings = document.getElementById(pair[1]);
      if (!toggle || !settings) return;
      settings.classList.toggle("admin-pay-settings--disabled", !toggle.checked);
    });
  }

  function openBuyerModal(ctx) {
    var title = document.getElementById("modal-raffle-buyer-title");
    var nameEl = document.getElementById("raffle-buyer-name");
    var phoneEl = document.getElementById("raffle-buyer-phone");
    var localityEl = document.getElementById("raffle-buyer-locality");
    if (title) title.textContent = "Номерок № " + String(ctx.ticket_number != null ? ctx.ticket_number : "");
    if (nameEl) nameEl.textContent = ctx.user_name || "Не указано";
    if (phoneEl) phoneEl.textContent = ctx.user_phone || "Не указано";
    if (localityEl) localityEl.textContent = ctx.user_locality || "Не указано";
    if (raffleBuyerReveal) raffleBuyerReveal.classList.remove("is-revealed");
    var chatUid = Number(ctx.user_id);
    if (chatBtn) {
      if (Number.isFinite(chatUid) && chatUid > 0) {
        chatBtn.hidden = false;
        chatBtn.dataset.userId = String(chatUid);
      } else {
        chatBtn.hidden = true;
        delete chatBtn.dataset.userId;
      }
    }
    if (modalBuyer) {
      modalBuyer.dataset.detachTicket = String(ctx.ticket_number != null ? ctx.ticket_number : "");
      if (Number.isFinite(chatUid) && chatUid > 0) modalBuyer.dataset.chatUserId = String(chatUid);
      else delete modalBuyer.dataset.chatUserId;
      modalBuyer.classList.add("is-open");
      modalBuyer.setAttribute("aria-hidden", "false");
    }
  }

  function closeBuyerModal() {
    if (!modalBuyer) return;
    delete modalBuyer.dataset.detachTicket;
    delete modalBuyer.dataset.chatUserId;
    modalBuyer.classList.remove("is-open");
    modalBuyer.setAttribute("aria-hidden", "true");
    if (raffleBuyerReveal) raffleBuyerReveal.classList.remove("is-revealed");
    var chatBtn = document.getElementById("raffle-buyer-chat");
    if (chatBtn) {
      chatBtn.hidden = true;
      delete chatBtn.dataset.userId;
    }
  }

  function getParticipantsSearchDigits() {
    return String((participantsSearch && participantsSearch.value) || "")
      .trim()
      .replace(/[^\d]/g, "");
  }

  async function loadParticipantsPage(opts) {
    if (!participantsRaffleId) return;
    var reset = !!(opts && opts.reset);
    var includeWholesalers = !!(opts && opts.includeWholesalers);
    if (participantsLoading) return;
    participantsLoading = true;
    const reqId = ++participantsReqId;
    const searchDigits = getParticipantsSearchDigits();
    const offset = reset ? 0 : participantsOffset;
    if (reset && participantsList) {
      participantsList.innerHTML = '<p class="admin-raffle-participants__empty">Загрузка...</p>';
    }
    try {
      const qs = new URLSearchParams();
      qs.set("offset", String(offset));
      qs.set("limit", String(PARTICIPANTS_PAGE_SIZE));
      if (searchDigits) qs.set("q", searchDigits);
      qs.set("include_wholesalers", includeWholesalers ? "1" : "0");
      const data = await apiJson(
        "/api/admin/raffles/" + participantsRaffleId + "/participants?" + qs.toString(),
        {
          headers: authHeaders(),
          cache: "no-store",
        },
      );
      if (reqId !== participantsReqId || !participantsRaffleId) return;
      const rows = Array.isArray(data.participants) ? data.participants : [];
      participantsCache = reset ? rows : participantsCache.concat(rows);
      participantsTotal = Math.max(0, Number(data.total) || 0);
      participantsOffset = participantsCache.length;
      participantsHasMore = !!data.has_more || participantsOffset < participantsTotal;
      participantsWholesaleEnabled = !!data.wholesale_enabled;
      var wn = Math.floor(Number(data.wholesale_every_n_tickets));
      participantsWholesaleEveryN = Number.isFinite(wn) && wn >= 1 ? wn : 10;
      updateWholesalersLeadText();
      if (includeWholesalers) {
        wholesalersCache = Array.isArray(data.wholesalers) ? data.wholesalers : [];
        renderWholesalersList();
      }
      renderParticipantsList();
    } finally {
      participantsLoading = false;
    }
  }

  async function refreshParticipantsBundle() {
    await loadParticipantsPage({ reset: true, includeWholesalers: true });
  }

  async function adminDetachParticipantTicketByNumber(ticketNum, opts) {
    var closeBuyer = opts && opts.closeBuyer;
    if (!participantsRaffleId) return;
    var n = Math.floor(Number(ticketNum));
    if (!Number.isFinite(n) || n < 1) return;
    if (!confirm("Снять номерок № " + String(n) + "? Он снова станет свободным для продажи.")) return;
    try {
      await apiJson("/api/admin/raffles/" + participantsRaffleId + "/participant-tickets/" + String(n), {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (closeBuyer) closeBuyerModal();
      await refreshParticipantsBundle();
    } catch (err) {
      alert((err && err.message) || "Не удалось снять номерок");
    }
  }

  function setStatusBadge(status) {
    if (status === "active") {
      return '<span class="admin-raffle-badge admin-raffle-badge--active">Активен</span>';
    }
    if (status === "closed") {
      return '<span class="admin-raffle-badge admin-raffle-badge--closed">Закрыт</span>';
    }
    return '<span class="admin-raffle-badge admin-raffle-badge--paused">Пауза</span>';
  }

  function raffleCardHtml(r) {
    const cover =
      r.cover_image_url && String(r.cover_image_url).trim()
        ? '<img class="admin-raffle-card__cover" src="' +
          esc(String(r.cover_image_url)) +
          '" alt="" loading="lazy" />'
        : "";
    return (
      '<article class="admin-raffle-card" data-id="' +
      r.id +
      '" role="listitem">' +
      '<div class="admin-raffle-card__cover-wrap">' +
      (cover || "") +
      "</div>" +
      '<div class="admin-raffle-card__body">' +
      '<div class="admin-raffle-card__badges">' +
      setStatusBadge(r.status) +
      (r.hidden_from_public ? '<span class="admin-raffle-badge admin-raffle-badge--hidden">Скрыта</span>' : "") +
      "</div>" +
      '<h3 class="admin-raffle-card__title">' +
      esc(String(r.title)) +
      "</h3>" +
      '<p class="admin-raffle-card__meta">' +
      esc(String(r.price_rub)) +
      " ₽ за билет · " +
      esc(String(r.ticket_count)) +
      " номерков" +
      (r.cenopad_enabled && Number(r.cenopad_price_rub) > 0
        ? " · вторая цена " + esc(String(r.cenopad_price_rub)) + " ₽"
        : "") +
      (r.wholesale_enabled ? " · оптовики вкл." : "") +
      (r.promo_5_plus_1_enabled || r.promo_5_plus_2_enabled
        ? " · акция " +
          (r.promo_5_plus_2_enabled ? "5+2" : "5+1") +
          " (бонус 5+1: " +
          esc(String(Math.max(0, Number(r.promo_5_plus_1_locked_free_count) || 0))) +
          ", 5+2: " +
          esc(String(Math.max(0, Number(r.promo_5_plus_2_locked_free_count) || 0))) +
          ")"
        : "") +
      "</p>" +
      '<div class="admin-raffle-card__actions">' +
      '<div class="admin-raffle-card__row">' +
      '<button type="button" class="admin-raffle-btn admin-raffle-btn--participants admin-raffle-participants-btn" data-id="' +
      r.id +
      '">' +
      BTN_ICO.users +
      "<span>Участники</span></button>" +
      '<button type="button" class="admin-raffle-btn admin-raffle-btn--primary admin-raffle-edit" data-id="' +
      r.id +
      '">' +
      BTN_ICO.edit +
      "<span>Изменить</span></button>" +
      '<button type="button" class="admin-raffle-btn admin-raffle-btn--danger admin-raffle-delete" data-id="' +
      r.id +
      '">' +
      BTN_ICO.trash +
      "<span>Удалить</span></button>" +
      "</div>" +
      '<div class="admin-raffle-card__row">' +
      '<button type="button" class="admin-raffle-btn admin-raffle-pause" data-id="' +
      r.id +
      '"' +
      (r.status === "paused" ? " disabled" : "") +
      ">" +
      BTN_ICO.pause +
      "<span>Тех. пауза</span></button>" +
      '<button type="button" class="admin-raffle-btn admin-raffle-close" data-id="' +
      r.id +
      '"' +
      (r.status === "closed" ? " disabled" : "") +
      ">" +
      BTN_ICO.lock +
      "<span>Закрыть продажи</span></button>" +
      '<button type="button" class="admin-raffle-btn admin-raffle-active" data-id="' +
      r.id +
      '"' +
      (r.status === "active" ? " disabled" : "") +
      ">" +
      BTN_ICO.play +
      "<span>В активные</span></button>" +
      '<button type="button" class="admin-raffle-btn admin-raffle-notify" data-id="' +
      r.id +
      '"' +
      (r.status !== "active" || r.hidden_from_public ? " disabled" : "") +
      ">" +
      BTN_ICO.bell +
      "<span>ОПОВЕСТИТЬ</span></button>" +
      "</div></div></div></article>"
    );
  }

  function bindRaffleListButtons() {
    if (!listEl) return;
    listEl.querySelectorAll(".admin-raffle-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const id = Number(btn.getAttribute("data-id"));
        openForm(id);
      });
    });
    listEl.querySelectorAll(".admin-raffle-participants-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const id = Number(btn.getAttribute("data-id"));
        openParticipants(id);
      });
    });
    listEl.querySelectorAll(".admin-raffle-pause").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setStatus(Number(btn.getAttribute("data-id")), "paused");
      });
    });
    listEl.querySelectorAll(".admin-raffle-close").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setStatus(Number(btn.getAttribute("data-id")), "closed");
      });
    });
    listEl.querySelectorAll(".admin-raffle-active").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setStatus(Number(btn.getAttribute("data-id")), "active");
      });
    });
    listEl.querySelectorAll(".admin-raffle-delete").forEach(function (btn) {
      btn.addEventListener("click", function () {
        removeRaffle(Number(btn.getAttribute("data-id")));
      });
    });
    listEl.querySelectorAll(".admin-raffle-notify").forEach(function (btn) {
      btn.addEventListener("click", function () {
        notifyLaunch(Number(btn.getAttribute("data-id")));
      });
    });
  }

  function renderList() {
    if (!listEl) return;
    if (!rafflesCache.length) {
      listEl.innerHTML =
        '<div class="admin-raffles-empty" role="status">' +
        '<svg class="admin-raffles-empty__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
        '<path d="M20 12v10H4V12"></path><path d="M22 7H2v5h20z"></path><path d="M12 22V7"></path>' +
        '<path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>' +
        "</svg>" +
        '<p class="admin-raffles-empty__title">Пока пусто</p>' +
        '<p class="admin-raffles-empty__text">Создайте первую акцию — она появится на главной странице сайта.</p>' +
        "</div>";
      return;
    }

    var hiddenRows = rafflesCache.filter(function (r) {
      return !!r.hidden_from_public;
    });
    var activeSelling = rafflesCache.filter(function (r) {
      return !r.hidden_from_public && r.status === "active";
    });
    var pausedOnSite = rafflesCache.filter(function (r) {
      return !r.hidden_from_public && r.status !== "active";
    });

    var html = "";
    if (rafflesListTab === "hidden") {
      if (!hiddenRows.length) {
        listEl.innerHTML =
          '<div class="admin-raffles-empty" role="status">' +
          '<p class="admin-raffles-empty__title">Нет скрытых акций</p>' +
          '<p class="admin-raffles-empty__text">Включите «Скрыть с сайта» в карточке акции или переключите вкладку.</p>' +
          "</div>";
        return;
      }
      html = hiddenRows.map(raffleCardHtml).join("");
    } else {
      if (!activeSelling.length && !pausedOnSite.length) {
        listEl.innerHTML =
          '<div class="admin-raffles-empty" role="status">' +
          '<p class="admin-raffles-empty__title">Нет акций на сайте</p>' +
          '<p class="admin-raffles-empty__text">Все акции скрыты или ещё не созданы. Откройте вкладку «Скрытые».</p>' +
          "</div>";
        return;
      }
      html = activeSelling.concat(pausedOnSite).map(raffleCardHtml).join("");
    }

    listEl.innerHTML = html;
    bindRaffleListButtons();
  }

  async function loadRaffles() {
    const data = await apiJson("/api/admin/raffles", {
      headers: authHeaders(),
      cache: "no-store",
    });
    rafflesCache = data.raffles || [];
    renderList();
  }

  function getRaffle(id) {
    return rafflesCache.find(function (r) {
      return r.id === id;
    });
  }

  async function setStatus(id, status) {
    const r = getRaffle(id);
    if (!r) return;
    try {
      await apiJson("/api/admin/raffles/" + id, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...r,
          status: status,
        }),
      });
      await loadRaffles();
    } catch (e) {
      alert(e.message || "Ошибка");
    }
  }

  async function removeRaffle(id) {
    if (!confirm("Удалить акцию без восстановления?")) return;
    try {
      await apiJson("/api/admin/raffles/" + id, {
        method: "DELETE",
        headers: authHeaders(),
      });
      await loadRaffles();
    } catch (e) {
      alert(e.message || "Ошибка");
    }
  }

  async function notifyLaunch(id) {
    if (!Number.isFinite(id) || id < 1) return;
    try {
      await apiJson("/api/admin/raffles/" + id + "/notify-launch", {
        method: "POST",
        headers: authHeaders(),
      });
      alert("Пуш-оповещение отправлено.");
    } catch (e) {
      alert((e && e.message) || "Не удалось отправить оповещение");
    }
  }

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/raffles/upload", {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
    return data.url;
  }

  function openForm(editId) {
    if (!modalForm || !form) return;
    const edit = editId != null ? getRaffle(editId) : null;
    if (formTitle) formTitle.textContent = edit ? "Редактировать акцию" : "Новая акция";
    document.getElementById("raffle-edit-id").value = edit ? String(edit.id) : "";
    document.getElementById("raffle-title").value = edit ? edit.title : "";
    document.getElementById("raffle-cover-url").value = edit ? edit.cover_image_url || "" : "";
    document.getElementById("raffle-price").value = edit ? String(edit.price_rub) : "0";
    var cenopadEnabledEl = document.getElementById("raffle-cenopad-enabled");
    if (cenopadEnabledEl) cenopadEnabledEl.checked = edit ? !!edit.cenopad_enabled : false;
    var cenopadPriceEl = document.getElementById("raffle-cenopad-price");
    if (cenopadPriceEl) {
      cenopadPriceEl.value =
        edit && Number(edit.cenopad_price_rub) > 0 ? String(edit.cenopad_price_rub) : "";
    }
    var cenopadStatsEl = document.getElementById("raffle-cenopad-stats");
    if (cenopadStatsEl) {
      var baseTickets = Math.max(0, Number(edit && edit.sales_accounting && edit.sales_accounting.base_tickets) || 0);
      var baseAmount = Math.max(0, Number(edit && edit.sales_accounting && edit.sales_accounting.base_amount_rub) || 0);
      var secondTickets = Math.max(0, Number(edit && edit.sales_accounting && edit.sales_accounting.second_tickets) || 0);
      var secondAmount = Math.max(0, Number(edit && edit.sales_accounting && edit.sales_accounting.second_amount_rub) || 0);
      cenopadStatsEl.textContent =
        "Бухгалтерия продаж: основная цена — " +
        String(baseTickets) +
        " шт / " +
        String(baseAmount) +
        " ₽; вторая цена — " +
        String(secondTickets) +
        " шт / " +
        String(secondAmount) +
        " ₽";
    }
    var secondStartEl = document.getElementById("raffle-cenopad-start-at");
    if (secondStartEl)
      secondStartEl.value = edit ? formatDateTimeLocalFromMs(edit.second_price_start_at || edit.cenopad_start_at) : "";
    var secondEndEl = document.getElementById("raffle-cenopad-end-at");
    if (secondEndEl)
      secondEndEl.value = edit ? formatDateTimeLocalFromMs(edit.second_price_end_at || edit.cenopad_end_at) : "";
    document.getElementById("raffle-tickets").value = edit ? String(edit.ticket_count) : "0";
    document.getElementById("raffle-collection-url").value = edit ? edit.collection_url || "" : "";
    var tbankUrlEl = document.getElementById("raffle-tbank-collection-url");
    if (tbankUrlEl) tbankUrlEl.value = edit ? edit.tbank_collection_url || "" : "";
    var rulesEl = document.getElementById("raffle-rules-url");
    if (rulesEl) rulesEl.value = edit ? edit.rules_url || "" : "";
    var liveNoteEl = document.getElementById("raffle-live-stream-note");
    if (liveNoteEl) liveNoteEl.value = edit ? edit.live_stream_note || "" : "";
    var liveUrlEl = document.getElementById("raffle-live-stream-url");
    if (liveUrlEl) liveUrlEl.value = edit ? edit.live_stream_url || "" : "";
    var liveAtEl = document.getElementById("raffle-live-stream-at");
    if (liveAtEl) {
      liveAtEl.value = edit ? formatDateTimeLocalFromMs(edit.live_stream_at) : "";
    }
    var liveStatusEl = document.getElementById("raffle-live-stream-status");
    if (liveStatusEl) {
      var st = edit ? String(edit.live_stream_status || "scheduled").toLowerCase() : "scheduled";
      liveStatusEl.value = st === "live" || st === "ended" ? st : "scheduled";
    }
    var sberRecEl = document.getElementById("raffle-recipient-sber");
    if (sberRecEl)
      sberRecEl.value = edit
        ? edit.sber_collection_recipient || edit.collection_recipient || ""
        : "";
    var tbankRecEl = document.getElementById("raffle-recipient-tbank");
    if (tbankRecEl)
      tbankRecEl.value = edit
        ? edit.tbank_collection_recipient || edit.collection_recipient || ""
        : "";
    var qrRecEl = document.getElementById("raffle-qr-recipient");
    if (qrRecEl) qrRecEl.value = edit ? edit.qr_recipient || edit.collection_recipient || "" : "";
    var qrPurposeEl = document.getElementById("raffle-qr-purpose");
    if (qrPurposeEl) qrPurposeEl.value = edit ? edit.qr_payment_purpose || "Оплата услуг" : "Оплата услуг";
    var sberEnabledEl = document.getElementById("raffle-sber-enabled");
    if (sberEnabledEl)
      sberEnabledEl.checked = edit
        ? edit.sber_enabled != null
          ? !!edit.sber_enabled
          : !!(edit.collection_url && String(edit.collection_url).trim())
        : true;
    var tbankEnabledEl = document.getElementById("raffle-tbank-enabled");
    if (tbankEnabledEl)
      tbankEnabledEl.checked = edit
        ? edit.tbank_enabled != null
          ? !!edit.tbank_enabled
          : !!(edit.tbank_collection_url && String(edit.tbank_collection_url).trim())
        : false;
    var qrEnabledEl = document.getElementById("raffle-qr-enabled");
    if (qrEnabledEl)
      qrEnabledEl.checked = edit
        ? edit.qr_enabled != null
          ? !!edit.qr_enabled
          : !!(edit.qr_image_url && String(edit.qr_image_url).trim())
        : true;
    document.getElementById("raffle-qr-url").value = edit ? edit.qr_image_url || "" : "";
    document.getElementById("raffle-status").value = edit ? edit.status : "active";
    document.getElementById("raffle-sort").value = edit
      ? String(edit.sort_order != null ? edit.sort_order : 0)
      : String(
          rafflesCache.reduce(function (m, x) {
            return Math.max(m, Number(x.sort_order) || 0);
          }, 0) + 1,
        );
    var whEl = document.getElementById("raffle-wholesale-enabled");
    if (whEl) whEl.checked = edit ? !!edit.wholesale_enabled : false;
    var whN = document.getElementById("raffle-wholesale-every-n");
    if (whN) {
      var en = edit ? Math.max(1, Math.floor(Number(edit.wholesale_every_n_tickets)) || 10) : 10;
      whN.value = String(en);
    }
    syncWholesaleEveryNRow();
    var pack =
      edit && edit.promo_5_plus_2_enabled
        ? "5plus2"
        : edit && edit.promo_5_plus_1_enabled
          ? "5plus1"
          : "none";
    ["none", "5plus1", "5plus2"].forEach(function (v) {
      var el = document.getElementById("raffle-promo-pack-" + v);
      if (el) el.checked = pack === v;
    });
    var promoStatsEl = document.getElementById("raffle-promo-5-plus-1-stats");
    if (promoStatsEl) {
      var c1 = edit ? Math.max(0, Number(edit.promo_5_plus_1_locked_free_count) || 0) : 0;
      var c2 = edit ? Math.max(0, Number(edit.promo_5_plus_2_locked_free_count) || 0) : 0;
      promoStatsEl.textContent =
        "Закреплено бонусных номерков: по акции 5+1 — " + String(c1) + ", по акции 5+2 — " + String(c2);
    }
    var hidEl = document.getElementById("raffle-hidden-from-public");
    if (hidEl) hidEl.checked = edit ? !!edit.hidden_from_public : false;
    var cf = document.getElementById("raffle-cover-file");
    var qf = document.getElementById("raffle-qr-file");
    if (cf) cf.value = "";
    if (qf) qf.value = "";
    renderBankCardsFromEdit(edit);
    setPayTab("sber");
    syncPayMethodSettingsState();
    setFormLoading(false);
    modalForm.classList.add("is-open");
    modalForm.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeForm() {
    if (!modalForm) return;
    modalForm.classList.remove("is-open");
    modalForm.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setFormLoading(false);
  }

  function renderParticipantsList() {
    if (!participantsList) return;
    if (!participantsCache.length) {
      participantsList.innerHTML = '<p class="admin-raffle-participants__empty">Ничего не найдено.</p>';
      return;
    }
    participantsList.innerHTML = participantsCache
      .map(function (x) {
        const key = String(x.ticket_number) + "|" + String(x.user_phone || "");
        const revealed = revealedPhones.has(key);
        const wholesaleCls = x.is_wholesale ? " admin-raffle-participant-card--wholesale" : "";
        const preCls = x.order_status === "preassigned" ? " admin-raffle-participant-card--preassigned" : "";
        var uid = Number(x.user_id);
        var openBuyerDetail =
          Number.isFinite(uid) &&
          uid > 0 &&
          (x.order_status === "confirmed" ||
            x.order_status === "reserved" ||
            x.order_status === "pending_review");
        var ticketBlock = openBuyerDetail
          ? '<button type="button" class="admin-raffle-participant-card__ticket admin-raffle-participant-card__ticket--bought" data-ticket="' +
            esc(String(x.ticket_number)) +
            '" data-user-id="' +
            esc(String(uid)) +
            '" data-name="' +
            esc(String(x.user_name != null ? x.user_name : "")) +
            '" data-locality="' +
            esc(String(x.user_locality != null ? x.user_locality : "")) +
            '" data-phone="' +
            esc(String(x.user_phone || "")) +
            '">№ ' +
            esc(String(x.ticket_number)) +
            "</button>"
          : '<div class="admin-raffle-participant-card__ticket">№ ' +
            esc(String(x.ticket_number)) +
            "</div>";
        var statusInline =
          x.order_status === "preassigned"
            ? '<span class="admin-raffle-participant-card__pre">до регистрации</span>'
            : "";
        return (
          '<article class="admin-raffle-participant-card' +
          wholesaleCls +
          preCls +
          '">' +
          '<div class="admin-raffle-participant-card__line">' +
          '<div class="admin-raffle-participant-card__left">' +
          ticketBlock +
          statusInline +
          "</div>" +
          '<button type="button" class="admin-raffle-participant-card__phone' +
          (revealed ? "" : " is-masked") +
          '" data-key="' +
          esc(key) +
          '" data-phone="' +
          esc(String(x.user_phone || "")) +
          '">' +
          esc(String(x.user_phone || "-")) +
          "</button>" +
          '<button type="button" class="admin-raffle-participant-card__detach" data-admin-detach-ticket="1" data-ticket="' +
          esc(String(x.ticket_number)) +
          '" title="Снять номерок" aria-label="Снять номерок">' +
          PARTICIPANT_ICO_TRASH +
          "</button>" +
          "</div>" +
          "</article>"
        );
      })
      .join("");
    if (participantsHasMore) {
      participantsList.insertAdjacentHTML(
        "beforeend",
        '<div class="admin-raffle-participants__more">Прокрутите ниже, чтобы подгрузить еще...</div>',
      );
    }
    participantsList.querySelectorAll(".admin-raffle-participant-card__phone").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const key = btn.getAttribute("data-key");
        if (!key) return;
        revealedPhones.add(key);
        btn.classList.remove("is-masked");
      });
    });
  }

  function renderWholesalersList() {
    const el = document.getElementById("raffle-wholesalers-list");
    if (!el) return;
    if (!participantsWholesaleEnabled) {
      el.innerHTML =
        '<p class="admin-raffle-participants__empty" style="margin:0">' +
        "Оптовики для этой акции отключены. Включите опцию при редактировании акции.</p>";
      return;
    }
    if (!wholesalersCache.length) {
      el.innerHTML =
        '<p class="admin-raffle-participants__empty" style="margin:0;border-style:dashed">' +
        "Пока нет. Номер оптовика присваивается за каждые " +
        esc(wholesaleEveryNLabel()) +
        " закреплённых номерков по очереди.</p>";
      return;
    }
    el.innerHTML = wholesalersCache
      .map(function (w) {
        return (
          '<div class="admin-raffle-wholesaler-row">' +
          '<span class="admin-raffle-wholesaler-row__num">№ ' +
          esc(String(w.wholesale_number)) +
          "</span>" +
          "<span>" +
          esc(String(w.user_phone || "—")) +
          "</span>" +
          "</div>"
        );
      })
      .join("");
  }

  function normalizePhoneInput(raw) {
    const digits = String(raw || "").replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.length === 11) return digits;
    if (digits.length === 10) return "7" + digits;
    return digits;
  }

  function setParticipantsTab(tab) {
    if (tab === "assign") participantsActiveTab = "assign";
    else if (tab === "wholesalers") participantsActiveTab = "wholesalers";
    else participantsActiveTab = "participants";
    participantTabButtons().forEach(function (btn) {
      const isActive = btn.getAttribute("data-tab") === participantsActiveTab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    participantPanels().forEach(function (panel) {
      const isActive = panel.getAttribute("data-panel") === participantsActiveTab;
      panel.hidden = !isActive;
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
  }

  function setSingleAssignStatus(message, state) {
    if (!raffleSingleCheck) return;
    raffleSingleCheck.textContent = message;
    raffleSingleCheck.classList.remove("is-free", "is-busy", "is-error");
    if (state) raffleSingleCheck.classList.add(state);
  }

  function updateSingleAssignSubmitState() {
    if (!raffleSingleSubmit) return;
    const phone = normalizePhoneInput(raffleSinglePhone && raffleSinglePhone.value);
    raffleSingleSubmit.disabled = !participantsRaffleId || phone.length < 11 || !raffleSingleTicketIsFree;
  }

  async function runSingleTicketAvailabilityCheck() {
    if (!participantsRaffleId || !raffleSingleTicket) return;
    const raw = String(raffleSingleTicket.value || "").trim();
    if (!raw) {
      raffleSingleTicketIsFree = false;
      setSingleAssignStatus("Введите номерок для проверки.", "");
      updateSingleAssignSubmitState();
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) {
      raffleSingleTicketIsFree = false;
      setSingleAssignStatus("Номерок должен быть больше 0.", "is-error");
      updateSingleAssignSubmitState();
      return;
    }
    const reqId = ++raffleSingleCheckReqId;
    setSingleAssignStatus("Проверяем номерок...", "");
    try {
      const data = await apiJson(
        "/api/admin/raffles/" + participantsRaffleId + "/tickets/" + Math.floor(n) + "/availability",
        {
          headers: authHeaders(),
          cache: "no-store",
        },
      );
      if (reqId !== raffleSingleCheckReqId) return;
      raffleSingleTicketIsFree = !!data.is_free;
      if (raffleSingleTicketIsFree) {
        setSingleAssignStatus("Номерок свободен, можно выдавать.", "is-free");
      } else {
        setSingleAssignStatus("Номерок уже занят.", "is-busy");
      }
      updateSingleAssignSubmitState();
    } catch (err) {
      if (reqId !== raffleSingleCheckReqId) return;
      raffleSingleTicketIsFree = false;
      setSingleAssignStatus((err && err.message) || "Не удалось проверить номерок.", "is-error");
      updateSingleAssignSubmitState();
    }
  }

  function scheduleSingleTicketAvailabilityCheck() {
    if (raffleSingleCheckTimer) clearTimeout(raffleSingleCheckTimer);
    raffleSingleCheckTimer = setTimeout(function () {
      runSingleTicketAvailabilityCheck();
    }, 320);
  }

  function resetSingleAssignForm() {
    if (raffleSingleCheckTimer) {
      clearTimeout(raffleSingleCheckTimer);
      raffleSingleCheckTimer = null;
    }
    raffleSingleCheckReqId += 1;
    raffleSingleTicketIsFree = false;
    if (raffleSinglePhone) raffleSinglePhone.value = "";
    if (raffleSingleTicket) raffleSingleTicket.value = "";
    var singleNote = document.getElementById("raffle-single-note");
    if (singleNote && "value" in singleNote) singleNote.value = "";
    setSingleAssignStatus("Введите номерок для проверки.", "");
    updateSingleAssignSubmitState();
  }

  async function loadLegacyWinnerSourceSelect() {
    var sel = document.getElementById("raffle-legacy-source");
    if (!sel || sel.tagName !== "SELECT") return;
    sel.innerHTML = '<option value="">Загрузка…</option>';
    sel.disabled = true;
    try {
      const data = await apiJson("/api/admin/raffles", {
        headers: authHeaders(),
        cache: "no-store",
      });
      var list = Array.isArray(data.raffles) ? data.raffles : [];
      sel.innerHTML = "";
      var ph = document.createElement("option");
      ph.value = "";
      ph.textContent = "Выберите акцию-источник";
      sel.appendChild(ph);
      var curId = participantsRaffleId != null ? Number(participantsRaffleId) : NaN;
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        var rid = Math.floor(Number(r.id));
        if (!Number.isFinite(rid) || rid < 1) continue;
        if (Number.isFinite(curId) && rid === curId) continue;
        var o = document.createElement("option");
        o.value = String(rid);
        o.textContent = (r.title ? String(r.title) : "Акция #" + rid) + " (id " + String(rid) + ")";
        sel.appendChild(o);
      }
      if (sel.options.length <= 1) {
        var oEmpty = document.createElement("option");
        oEmpty.value = "";
        oEmpty.textContent = Number.isFinite(curId)
          ? "Нет других акций (источник должен отличаться от текущей)"
          : "В базе нет акций";
        sel.appendChild(oEmpty);
        sel.disabled = true;
        return;
      }
      sel.disabled = false;
    } catch (err) {
      sel.innerHTML = "";
      var o2 = document.createElement("option");
      o2.value = "";
      o2.textContent = (err && err.message) || "Не удалось загрузить акции";
      sel.appendChild(o2);
      sel.disabled = true;
    }
  }

  async function openParticipants(raffleId) {
    if (!modalParticipants || !participantsList) return;
    participantsRaffleId = raffleId;
    participantsCache = [];
    wholesalersCache = [];
    participantsWholesaleEnabled = false;
    participantsWholesaleEveryN = 10;
    updateWholesalersLeadText();
    participantsTotal = 0;
    participantsOffset = 0;
    participantsHasMore = false;
    participantsReqId += 1;
    revealedPhones.clear();
    if (participantsSearch) participantsSearch.value = "";
    var bulkTa = document.getElementById("raffle-bulk-phones");
    var bulkStart = document.getElementById("raffle-bulk-start");
    var bulkRes = document.getElementById("raffle-bulk-result");
    if (bulkTa) bulkTa.value = "";
    if (bulkStart) bulkStart.value = "1";
    if (bulkRes) {
      bulkRes.hidden = true;
      bulkRes.textContent = "";
      bulkRes.className = "admin-raffle-bulk-assign__result";
    }
    var legTa = document.getElementById("raffle-legacy-source-tickets");
    var legStart = document.getElementById("raffle-legacy-target-start");
    var legNote = document.getElementById("raffle-legacy-note");
    var legRes = document.getElementById("raffle-legacy-result");
    if (legTa && "value" in legTa) legTa.value = "";
    if (legStart && "value" in legStart) legStart.value = "1";
    if (legNote && "value" in legNote) legNote.value = "";
    if (legRes) {
      legRes.hidden = true;
      legRes.textContent = "";
      legRes.className = "admin-raffle-bulk-assign__result";
    }
    void loadLegacyWinnerSourceSelect();
    setParticipantsTab("participants");
    resetSingleAssignForm();
    participantsList.innerHTML = '<p class="admin-raffle-participants__empty">Загрузка...</p>';
    modalParticipants.classList.add("is-open");
    modalParticipants.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    try {
      await loadParticipantsPage({ reset: true, includeWholesalers: true });
    } catch (e) {
      participantsList.innerHTML =
        '<p class="admin-raffle-participants__empty">' +
        esc((e && e.message) || "Не удалось загрузить участников") +
        "</p>";
    }
  }

  function closeParticipants() {
    closeBuyerModal();
    if (!modalParticipants) return;
    modalParticipants.classList.remove("is-open");
    modalParticipants.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    resetSingleAssignForm();
    if (participantsSearchTimer) {
      clearTimeout(participantsSearchTimer);
      participantsSearchTimer = null;
    }
    participantsRaffleId = null;
  }

  function setFormLoading(loading) {
    var btn = document.getElementById("btn-raffle-submit");
    var label = document.getElementById("btn-raffle-submit-label");
    if (btn) btn.disabled = !!loading;
    if (label) label.textContent = loading ? "Сохранение…" : "Сохранить";
  }

  function renderLoadError(message) {
    if (!listEl) return;
    listEl.innerHTML =
      '<div class="admin-raffles-load-error" role="alert">' +
      '<p class="admin-raffles-load-error__text">' +
      esc(message || "Не удалось загрузить список") +
      "</p>" +
      '<button type="button" class="btn btn--primary" id="btn-raffles-retry">Повторить</button>' +
      "</div>";
    var btn = document.getElementById("btn-raffles-retry");
    if (btn) {
      btn.addEventListener("click", function () {
        loadRaffles().catch(function (err) {
          renderLoadError(err.message || "Ошибка загрузки");
        });
      });
    }
  }

  async function syncSessionFromServer() {
    const s = loadSession();
    if (!s || !s.token) return;
    try {
      const me = await apiJson("/api/auth/me", {
        headers: { Authorization: "Bearer " + s.token },
      });
      const merged = {
        ...s,
        phone: me.user.phone,
        name: me.user.name,
        role: me.user.role != null ? me.user.role : s.role || "user",
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (_) {
      /* не блокируем работу раздела */
    }
  }

  /**
   * Вызывается из admin.js после общей проверки admin-сессии (вкладка ?tab=raffles).
   * Отдельный «замок» на этой странице не показываем — тот же контекст, что и поддержка.
   */
  function bindRafflesCatalogTabsOnce() {
    if (window.__abRafflesCatalogTabsBound) return;
    window.__abRafflesCatalogTabsBound = true;
    document.querySelectorAll("[data-raffles-tab]").forEach(function (tabBtn) {
      tabBtn.addEventListener("click", function () {
        var t = tabBtn.getAttribute("data-raffles-tab");
        if (t !== "active" && t !== "hidden") return;
        rafflesListTab = t;
        document.querySelectorAll("[data-raffles-tab]").forEach(function (b) {
          var on = b.getAttribute("data-raffles-tab") === t;
          b.classList.toggle("admin-raffles-tab--active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        renderList();
      });
    });
  }

  window.abInitRaffles = function () {
    bindRafflesCatalogTabsOnce();
    loadRaffles().catch(function (err) {
      var st = err && err.status;
      if (st === 401) {
        renderLoadError("Сессия истекла или токен недействителен. Обновите страницу и войдите снова.");
        return;
      }
      if (st === 403) {
        renderLoadError("Нет доступа к API акций.");
        return;
      }
      renderLoadError(
        (err && err.message) ||
          "Не удалось загрузить акции. Проверьте, что API запущен и прокси /api настроен.",
      );
    });
    syncSessionFromServer();
  };

  document.getElementById("btn-raffle-new")?.addEventListener("click", function () {
    openForm(null);
  });
  document.getElementById("raffle-wholesale-enabled")?.addEventListener("change", syncWholesaleEveryNRow);
  document.getElementById("modal-raffle-form-close")?.addEventListener("click", closeForm);
  document.getElementById("btn-raffle-cancel")?.addEventListener("click", closeForm);
  document
    .getElementById("modal-raffle-participants-close")
    ?.addEventListener("click", closeParticipants);
  document.getElementById("modal-raffle-buyer-close")?.addEventListener("click", closeBuyerModal);
  participantsSearch?.addEventListener("input", function () {
    if (!participantsRaffleId) return;
    if (participantsSearchTimer) clearTimeout(participantsSearchTimer);
    participantsSearchTimer = setTimeout(function () {
      participantsSearchTimer = null;
      void loadParticipantsPage({ reset: true, includeWholesalers: false }).catch(function (err) {
        if (!participantsList) return;
        participantsList.innerHTML =
          '<p class="admin-raffle-participants__empty">' +
          esc((err && err.message) || "Не удалось загрузить участников") +
          "</p>";
      });
    }, 250);
  });
  participantsList?.addEventListener("scroll", function () {
    if (!participantsRaffleId || participantsActiveTab !== "participants") return;
    if (!participantsHasMore || participantsLoading) return;
    var nearBottom =
      participantsList.scrollTop + participantsList.clientHeight >= participantsList.scrollHeight - 120;
    if (!nearBottom) return;
    void loadParticipantsPage({ reset: false, includeWholesalers: false }).catch(function () {});
  });
  modalParticipants?.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest && e.target.closest(".admin-raffle-participants-tab");
    if (!btn || !modalParticipants.contains(btn)) return;
    var t = btn.getAttribute("data-tab");
    if (t) setParticipantsTab(t);
  });
  payTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      setPayTab(tab.getAttribute("data-pay-tab"));
    });
  });
  document.getElementById("raffle-sber-enabled")?.addEventListener("change", syncPayMethodSettingsState);
  document.getElementById("raffle-tbank-enabled")?.addEventListener("change", syncPayMethodSettingsState);
  document.getElementById("raffle-qr-enabled")?.addEventListener("change", syncPayMethodSettingsState);
  document.getElementById("raffle-card-payment-scope")?.addEventListener("change", syncCardPaymentScopeUi);
  raffleSinglePhone?.addEventListener("input", updateSingleAssignSubmitState);
  raffleSingleTicket?.addEventListener("input", function () {
    raffleSingleTicketIsFree = false;
    updateSingleAssignSubmitState();
    scheduleSingleTicketAvailabilityCheck();
  });
  raffleSingleSubmit?.addEventListener("click", function () {
    if (!participantsRaffleId) return;
    const phone = normalizePhoneInput(raffleSinglePhone && raffleSinglePhone.value);
    const ticketNumber = Math.floor(Number(raffleSingleTicket && raffleSingleTicket.value));
    if (!phone || phone.length < 11) {
      setSingleAssignStatus("Укажите корректный телефон (11 цифр).", "is-error");
      updateSingleAssignSubmitState();
      return;
    }
    if (!Number.isFinite(ticketNumber) || ticketNumber < 1) {
      setSingleAssignStatus("Укажите корректный номерок.", "is-error");
      updateSingleAssignSubmitState();
      return;
    }
    raffleSingleSubmit.disabled = true;
    setSingleAssignStatus("Выдаём номерок...", "");
    (async function () {
      try {
        var noteEl = document.getElementById("raffle-single-note");
        var admin_note = noteEl && "value" in noteEl ? String(noteEl.value || "").trim().slice(0, 500) : "";
        await apiJson("/api/admin/raffles/" + participantsRaffleId + "/assign-phone-ticket", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: phone,
            ticket_number: ticketNumber,
            admin_note: admin_note || undefined,
          }),
        });
        setSingleAssignStatus("Номерок успешно выдан.", "is-free");
        await refreshParticipantsBundle();
        raffleSingleTicketIsFree = false;
        if (raffleSingleTicket) raffleSingleTicket.value = "";
        if (noteEl && "value" in noteEl) noteEl.value = "";
        updateSingleAssignSubmitState();
      } catch (err) {
        raffleSingleTicketIsFree = false;
        setSingleAssignStatus((err && err.message) || "Не удалось выдать номерок.", "is-error");
        updateSingleAssignSubmitState();
      } finally {
        if (raffleSingleSubmit) raffleSingleSubmit.disabled = false;
        updateSingleAssignSubmitState();
      }
    })();
  });

  /** Делегирование: кнопка внутри модалки, клик по тексту/краю — всё попадает в обработчик. */
  document.addEventListener(
    "click",
    function (e) {
      var btn = e.target && e.target.closest && e.target.closest("#raffle-bulk-submit");
      if (!btn) return;
      if (!modalParticipants || !modalParticipants.classList.contains("is-open")) return;
      e.preventDefault();
      if (!participantsRaffleId) {
        alert("Откройте участников акции кнопкой «Участники» на карточке, затем снова нажмите «Назначить».");
        return;
      }
      var ta = document.getElementById("raffle-bulk-phones");
      var startEl = document.getElementById("raffle-bulk-start");
      var resultEl = document.getElementById("raffle-bulk-result");
      var text = ta && ta.value ? String(ta.value) : "";
      var start_number = startEl && String(startEl.value).trim() !== "" ? Number(startEl.value) : 1;
      if (!Number.isFinite(start_number) || start_number < 1) {
        alert("Укажите корректный первый номерок (от 1)");
        return;
      }
      btn.disabled = true;
      (async function () {
        try {
          const data = await apiJson("/api/admin/raffles/" + participantsRaffleId + "/bulk-assign-phones", {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ text: text, start_number: start_number }),
          });
          const assigned = data.assigned != null ? Number(data.assigned) : 0;
          const skipped = Array.isArray(data.skipped) ? data.skipped : [];
          if (resultEl) {
            resultEl.hidden = false;
            var msg = "Назначено номерков: " + String(assigned);
        if (skipped.length) {
          msg +=
            ". Пропущено строк: " +
            String(skipped.length) +
            " (повтор телефона, уже есть в акции или не нашлось свободного номера с нужного места).";
          resultEl.className = "admin-raffle-bulk-assign__result is-warn";
            } else {
              resultEl.className = "admin-raffle-bulk-assign__result is-ok";
            }
            resultEl.textContent = msg;
          }
          await refreshParticipantsBundle();
        } catch (err) {
          alert((err && err.message) || "Не удалось назначить");
        } finally {
          btn.disabled = false;
        }
      })();
    },
    true,
  );
  document.addEventListener(
    "click",
    function (e) {
      var btn = e.target && e.target.closest && e.target.closest("#raffle-legacy-submit");
      if (!btn) return;
      if (!modalParticipants || !modalParticipants.classList.contains("is-open")) return;
      e.preventDefault();
      if (!participantsRaffleId) {
        alert("Откройте участников акции с карточки.");
        return;
      }
      var sel = document.getElementById("raffle-legacy-source");
      var sourceId = sel && sel.value ? Number(sel.value) : 0;
      if (!Number.isFinite(sourceId) || sourceId < 1) {
        alert("Выберите акцию-источник в списке.");
        return;
      }
      var ta = document.getElementById("raffle-legacy-source-tickets");
      var startEl = document.getElementById("raffle-legacy-target-start");
      var noteEl = document.getElementById("raffle-legacy-note");
      var resultEl = document.getElementById("raffle-legacy-result");
      var rawTickets = ta && ta.value ? String(ta.value).trim() : "";
      if (!rawTickets) {
        alert("Укажите номерки из акции-источника через запятую.");
        return;
      }
      var start_number = startEl && String(startEl.value).trim() !== "" ? Number(startEl.value) : 1;
      if (!Number.isFinite(start_number) || start_number < 1) {
        alert("Укажите корректный первый номерок в этой акции (от 1).");
        return;
      }
      var admin_note = noteEl && "value" in noteEl ? String(noteEl.value || "").trim().slice(0, 500) : "";
      btn.disabled = true;
      (async function () {
        try {
          const data = await apiJson("/api/admin/raffles/" + participantsRaffleId + "/bulk-assign-legacy-winners", {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({
              source_raffle_id: sourceId,
              source_ticket_numbers: rawTickets,
              start_number: start_number,
              admin_note: admin_note || undefined,
            }),
          });
          const assigned = data.assigned != null ? Number(data.assigned) : 0;
          const skipped = Array.isArray(data.skipped) ? data.skipped : [];
          if (resultEl) {
            resultEl.hidden = false;
            var msg = "Назначено номерков: " + String(assigned);
            if (skipped.length) {
              msg +=
                ". Пропущено строк: " +
                String(skipped.length) +
                " (занятый номерок, повтор телефона, уже в акции и т.п.).";
              resultEl.className = "admin-raffle-bulk-assign__result is-warn";
            } else {
              resultEl.className = "admin-raffle-bulk-assign__result is-ok";
            }
            resultEl.textContent = msg;
          }
          await refreshParticipantsBundle();
        } catch (err) {
          alert((err && err.message) || "Не удалось назначить");
        } finally {
          btn.disabled = false;
        }
      })();
    },
    true,
  );
  participantsList?.addEventListener("click", function (e) {
    var detach = e.target && e.target.closest && e.target.closest("[data-admin-detach-ticket]");
    if (detach) {
      e.preventDefault();
      e.stopPropagation();
      var tn = Number(detach.getAttribute("data-ticket"));
      adminDetachParticipantTicketByNumber(tn, { closeBuyer: false });
      return;
    }
    var btn =
      e.target && e.target.closest && e.target.closest(".admin-raffle-participant-card__ticket.admin-raffle-participant-card__ticket--bought");
    if (!btn) return;
    e.preventDefault();
    openBuyerModal({
      ticket_number: Number(btn.getAttribute("data-ticket")) || 0,
      user_id: Number(btn.getAttribute("data-user-id")) || 0,
      user_name: btn.getAttribute("data-name") || "",
      user_locality: btn.getAttribute("data-locality") || "",
      user_phone: btn.getAttribute("data-phone") || "",
    });
  });
  document.getElementById("raffle-buyer-chat")?.addEventListener("click", function () {
    var id = Number(this.getAttribute("data-user-id"));
    if (!Number.isFinite(id) || id < 1) return;
    if (typeof window.abAdminOpenSupportChat !== "function") {
      alert("Чат недоступен. Обновите страницу админки.");
      return;
    }
    closeBuyerModal();
    if (modalParticipants) closeParticipants();
    window.abAdminOpenSupportChat(id);
  });
  document.getElementById("raffle-buyer-detach")?.addEventListener("click", function () {
    if (!modalBuyer || !modalBuyer.dataset.detachTicket) return;
    var tn = Number(modalBuyer.dataset.detachTicket);
    adminDetachParticipantTicketByNumber(tn, { closeBuyer: true });
  });
  modalBuyer?.addEventListener("click", function (e) {
    if (e.target === modalBuyer) closeBuyerModal();
  });
  raffleBuyerReveal?.addEventListener("click", function () {
    raffleBuyerReveal.classList.toggle("is-revealed");
  });
  raffleBuyerReveal?.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    raffleBuyerReveal.classList.toggle("is-revealed");
  });
  modalForm?.addEventListener("click", function (e) {
    if (e.target === modalForm) closeForm();
  });
  modalParticipants?.addEventListener("click", function (e) {
    if (e.target === modalParticipants) closeParticipants();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (modalBuyer && modalBuyer.classList.contains("is-open")) {
      closeBuyerModal();
      return;
    }
    if (modalForm && modalForm.classList.contains("is-open")) closeForm();
    if (modalParticipants && modalParticipants.classList.contains("is-open")) closeParticipants();
  });

  form?.addEventListener("submit", async function (e) {
    e.preventDefault();
    const editId = document.getElementById("raffle-edit-id").value.trim();
    let coverUrl = document.getElementById("raffle-cover-url").value.trim();
    let qrUrl = document.getElementById("raffle-qr-url").value.trim();
    let coverFile = document.getElementById("raffle-cover-file").files[0];
    let qrFile = document.getElementById("raffle-qr-file").files[0];
    setFormLoading(true);
    try {
      if (coverFile) coverUrl = await uploadFile(coverFile);
      if (qrFile) qrUrl = await uploadFile(qrFile);
    } catch (err) {
      setFormLoading(false);
      alert(err.message || "Ошибка загрузки файла");
      return;
    }
    let bank_cards;
    try {
      bank_cards = collectBankCardsPayload();
    } catch (err) {
      setFormLoading(false);
      alert(err.message || "Ошибка списка карт");
      return;
    }
    const payload = {
      title: document.getElementById("raffle-title").value.trim(),
      cover_image_url: coverUrl,
      price_rub: Number(document.getElementById("raffle-price").value),
      cenopad_enabled: (function () {
        var el = document.getElementById("raffle-cenopad-enabled");
        return el ? !!el.checked : false;
      })(),
      cenopad_price_rub: (function () {
        var el = document.getElementById("raffle-cenopad-price");
        var s = el && String(el.value || "").trim();
        return s === "" ? 0 : Number(s);
      })(),
      cenopad_start_at: (function () {
        var el = document.getElementById("raffle-cenopad-start-at");
        return parseDateTimeLocalToMs(el ? el.value : "");
      })(),
      cenopad_end_at: (function () {
        var el = document.getElementById("raffle-cenopad-end-at");
        return parseDateTimeLocalToMs(el ? el.value : "");
      })(),
      old_price_rub: 0,
      ticket_count: Number(document.getElementById("raffle-tickets").value),
      collection_url: document.getElementById("raffle-collection-url").value.trim(),
      tbank_collection_url: (function () {
        var el = document.getElementById("raffle-tbank-collection-url");
        return el ? String(el.value || "").trim() : "";
      })(),
      rules_url: (function () {
        var el = document.getElementById("raffle-rules-url");
        return el ? String(el.value || "").trim() : "";
      })(),
      live_stream_note: (function () {
        var el = document.getElementById("raffle-live-stream-note");
        return el ? String(el.value || "").trim() : "";
      })(),
      live_stream_url: (function () {
        var el = document.getElementById("raffle-live-stream-url");
        return el ? String(el.value || "").trim() : "";
      })(),
      live_stream_at: (function () {
        var el = document.getElementById("raffle-live-stream-at");
        return parseDateTimeLocalToMs(el ? el.value : "");
      })(),
      live_stream_status: (function () {
        var el = document.getElementById("raffle-live-stream-status");
        var st = String((el && el.value) || "scheduled").trim().toLowerCase();
        return st === "live" || st === "ended" ? st : "scheduled";
      })(),
      collection_recipient: (function () {
        var el = document.getElementById("raffle-recipient-sber");
        return el ? String(el.value || "").trim() : "";
      })(),
      sber_collection_recipient: (function () {
        var el = document.getElementById("raffle-recipient-sber");
        return el ? String(el.value || "").trim() : "";
      })(),
      tbank_collection_recipient: (function () {
        var el = document.getElementById("raffle-recipient-tbank");
        return el ? String(el.value || "").trim() : "";
      })(),
      qr_image_url: qrUrl,
      qr_recipient: (function () {
        var el = document.getElementById("raffle-qr-recipient");
        return el ? String(el.value || "").trim() : "";
      })(),
      qr_payment_purpose: (function () {
        var el = document.getElementById("raffle-qr-purpose");
        var txt = el ? String(el.value || "").trim() : "";
        return txt || "Оплата услуг";
      })(),
      sber_enabled: (function () {
        var el = document.getElementById("raffle-sber-enabled");
        return el ? !!el.checked : false;
      })(),
      tbank_enabled: (function () {
        var el = document.getElementById("raffle-tbank-enabled");
        return el ? !!el.checked : false;
      })(),
      qr_enabled: (function () {
        var el = document.getElementById("raffle-qr-enabled");
        return el ? !!el.checked : false;
      })(),
      status: document.getElementById("raffle-status").value,
      sort_order: Number(document.getElementById("raffle-sort").value) || 0,
      wholesale_enabled: (function () {
        var w = document.getElementById("raffle-wholesale-enabled");
        return w ? !!w.checked : false;
      })(),
      wholesale_every_n_tickets: (function () {
        var el = document.getElementById("raffle-wholesale-every-n");
        var n = el ? Math.floor(Number(el.value)) : 10;
        if (!Number.isFinite(n) || n < 1) n = 10;
        return n;
      })(),
      card_payment_scope: (function () {
        var el = document.getElementById("raffle-card-payment-scope");
        var v = String((el && el.value) || "unlimited").trim().toLowerCase();
        if (v === "wholesale_only" || v === "min_order_tickets") return v;
        return "unlimited";
      })(),
      card_payment_min_tickets: (function () {
        var el = document.getElementById("raffle-card-payment-min-tickets");
        var n = el ? Math.floor(Number(el.value)) : 2;
        if (!Number.isFinite(n) || n < 1) n = 2;
        return n;
      })(),
      bank_cards: bank_cards,
      promo_5_plus_1_enabled: (function () {
        var el = document.querySelector('input[name="raffle-promo-pack"]:checked');
        return el && el.value === "5plus1";
      })(),
      promo_5_plus_2_enabled: (function () {
        var el = document.querySelector('input[name="raffle-promo-pack"]:checked');
        return el && el.value === "5plus2";
      })(),
      hidden_from_public: (function () {
        var h = document.getElementById("raffle-hidden-from-public");
        return h ? !!h.checked : false;
      })(),
    };
    try {
      if (editId) {
        await apiJson("/api/admin/raffles/" + editId, {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await apiJson("/api/admin/raffles", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      closeForm();
      await loadRaffles();
    } catch (err) {
      alert(err.message || "Ошибка сохранения");
    } finally {
      setFormLoading(false);
    }
  });

  document.getElementById("raffle-bank-cards-list")?.addEventListener("click", function (ev) {
    var t = ev.target;
    var btn = t && t.closest ? t.closest("button") : null;
    if (!btn) return;
    var row = btn.closest("[data-bank-card-row]");
    if (!row) return;
    var wrap = document.getElementById("raffle-bank-cards-list");
    if (btn.classList.contains("admin-bank-card-remove")) {
      row.remove();
      if (wrap && !wrap.querySelector("[data-bank-card-row]")) {
        wrap.innerHTML = '<p class="admin-raffle-field-hint">Нет карт. Нажмите «Добавить карту».</p>';
      }
      return;
    }
    if (btn.classList.contains("admin-bank-card-snooze")) {
      var inp = row.querySelector(".admin-bank-card-disabled-until");
      if (inp) inp.value = formatDateTimeLocalFromMs(Date.now() + 24 * 60 * 60 * 1000);
      return;
    }
    if (btn.classList.contains("admin-bank-card-clear-until")) {
      var inp2 = row.querySelector(".admin-bank-card-disabled-until");
      if (inp2) inp2.value = "";
    }
  });
  document.getElementById("raffle-bank-card-add")?.addEventListener("click", function () {
    var wrap = document.getElementById("raffle-bank-cards-list");
    if (!wrap) return;
    if (!wrap.querySelector("[data-bank-card-row]")) wrap.innerHTML = "";
    wrap.insertAdjacentHTML("beforeend", bankCardRowHtml({ daily_max_orders: 0 }));
  });
})();
