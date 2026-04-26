(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";

  /** @type {Array<Record<string, unknown>>} */
  let rafflesCache = [];
  /** @type {'active' | 'hidden'} */
  let rafflesListTab = "active";
  /** @type {Array<{ticket_number:number,user_phone:string,order_status:string,is_wholesale?:boolean,user_id?:number,user_name?:string,user_email?:string,user_locality?:string}>} */
  let participantsCache = [];
  /** @type {Array<{wholesale_number:number,user_phone:string}>} */
  let wholesalersCache = [];
  let participantsRaffleId = null;
  let participantsActiveTab = "participants";
  let participantsWholesaleEnabled = false;
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
  };

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
    var emailEl = document.getElementById("raffle-buyer-email");
    var localityEl = document.getElementById("raffle-buyer-locality");
    var chatBtn = document.getElementById("raffle-buyer-chat");
    if (title) title.textContent = "Номерок № " + String(ctx.ticket_number);
    if (nameEl) nameEl.textContent = ctx.user_name || "Не указано";
    if (phoneEl) phoneEl.textContent = ctx.user_phone || "Не указано";
    if (emailEl) emailEl.textContent = ctx.user_email || "Не указано";
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
        ? " · ценопад " +
          esc(String(r.cenopad_price_rub)) +
          " ₽ (взято: " +
          esc(String(Math.max(0, Number(r.cenopad_sold_count) || 0))) +
          ")"
        : "") +
      (r.wholesale_enabled ? " · оптовики вкл." : "") +
      (r.promo_5_plus_1_enabled
        ? " · 5+1 вкл. (бонусных: " +
          esc(String(Math.max(0, Number(r.promo_5_plus_1_locked_free_count) || 0))) +
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
      cenopadStatsEl.textContent =
        "Подтверждено номерков по ценопаду: " +
        String(edit ? Math.max(0, Number(edit.cenopad_sold_count) || 0) : 0);
    }
    var rop = document.getElementById("raffle-old-price");
    if (rop) {
      rop.value =
        edit && edit.old_price_rub != null && Number(edit.old_price_rub) > 0
          ? String(edit.old_price_rub)
          : "";
    }
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
    var promoEl = document.getElementById("raffle-promo-5-plus-1-enabled");
    if (promoEl) promoEl.checked = edit ? !!edit.promo_5_plus_1_enabled : false;
    var promoStatsEl = document.getElementById("raffle-promo-5-plus-1-stats");
    if (promoStatsEl) {
      var locked = edit ? Math.max(0, Number(edit.promo_5_plus_1_locked_free_count) || 0) : 0;
      promoStatsEl.textContent = "Закреплено бесплатных номерков: " + String(locked);
    }
    var hidEl = document.getElementById("raffle-hidden-from-public");
    if (hidEl) hidEl.checked = edit ? !!edit.hidden_from_public : false;
    var cf = document.getElementById("raffle-cover-file");
    var qf = document.getElementById("raffle-qr-file");
    if (cf) cf.value = "";
    if (qf) qf.value = "";
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
            '" data-email="' +
            esc(String(x.user_email != null ? x.user_email : "")) +
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
        "Пока нет. Номер оптовика присваивается за каждые 10 закреплённых номерков по очереди.</p>";
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
    setSingleAssignStatus("Введите номерок для проверки.", "");
    updateSingleAssignSubmitState();
  }

  async function openParticipants(raffleId) {
    if (!modalParticipants || !participantsList) return;
    participantsRaffleId = raffleId;
    participantsCache = [];
    wholesalersCache = [];
    participantsWholesaleEnabled = false;
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
        email: me.user.email,
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
        await apiJson("/api/admin/raffles/" + participantsRaffleId + "/assign-phone-ticket", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: phone,
            ticket_number: ticketNumber,
          }),
        });
        setSingleAssignStatus("Номерок успешно выдан.", "is-free");
        await refreshParticipantsBundle();
        raffleSingleTicketIsFree = false;
        if (raffleSingleTicket) raffleSingleTicket.value = "";
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
      user_email: btn.getAttribute("data-email") || "",
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
      old_price_rub: (function () {
        var el = document.getElementById("raffle-old-price");
        var s = el && String(el.value || "").trim();
        return s === "" ? 0 : Number(s);
      })(),
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
      promo_5_plus_1_enabled: (function () {
        var x = document.getElementById("raffle-promo-5-plus-1-enabled");
        return x ? !!x.checked : false;
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
})();
