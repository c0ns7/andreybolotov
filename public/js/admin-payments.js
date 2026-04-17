(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";

  /** Декоративные иконки (фиксированный SVG) */
  const ICO = {
    raffle:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
    rub:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
    user:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
    tickets:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"></path><path d="M13 5v2M13 17v2M13 11v2"></path></svg>',
    bank:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01"></path></svg>',
    receipt:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"></path></svg>',
    check:
      '<svg class="admin-payment-btn__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    x:
      '<svg class="admin-payment-btn__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"></path></svg>',
    inbox:
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
    time:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
    chat:
      '<svg class="admin-payment-btn__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    unlock:
      '<svg class="admin-payment-btn__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>',
  };

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (j && j.token && j.phone) return j;
      return null;
    } catch {
      return null;
    }
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /** Метка времени заявки в часовом поясе браузера (локально для администратора). */
  function formatOrderCreatedLocal(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "—";
    var d = new Date(n);
    return d.toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
  }

  /** Если часы устройства заметно расходятся с сервером — короткая подсказка. */
  function renderServerSkewNote(serverMs) {
    if (serverMs == null || !Number.isFinite(Number(serverMs))) return "";
    var deltaSec = Math.round((Number(serverMs) - Date.now()) / 1000);
    if (Math.abs(deltaSec) <= 30) return "";
    var absSec = Math.abs(deltaSec);
    var human =
      absSec < 120
        ? String(absSec) + " с"
        : absSec < 7200
          ? String(Math.round(absSec / 60)) + " мин"
          : String(Math.round(absSec / 3600)) + " ч";
    var dir =
      deltaSec > 0
        ? "время на сервере опережает часы устройства"
        : "время на сервере отстаёт от часов устройства";
    return (
      '<div class="admin-payments-skew" role="status">' +
      "<p>Замечено расхождение примерно на " +
      esc(human) +
      ": " +
      esc(dir) +
      ". Дата и время заявки ниже показаны <strong>в часовом поясе этого браузера</strong> (ваше локальное время).</p>" +
      "</div>"
    );
  }

  var reservedUntilCountdownTimerId = null;

  function formatTimeLeftMs(leftMs) {
    var n = Number(leftMs);
    if (!Number.isFinite(n)) return "—";
    if (n <= 0) return "0:00";
    var sec = Math.floor(n / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    if (m < 60) return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    var h = Math.floor(m / 60);
    m = m % 60;
    return String(h) + ":" + String(m).padStart(2, "0");
  }

  function initReservedUntilCountdown(serverTimeMs) {
    if (reservedUntilCountdownTimerId) clearInterval(reservedUntilCountdownTimerId);
    var skewMs = Number(serverTimeMs) - Date.now();

    function paint() {
      var nowPlusSkew = Date.now() + skewMs;
      document
        .querySelectorAll(".admin-payment-card__countdown[data-expire-ts]")
        .forEach(function (el) {
          var expireTs = Number(el.getAttribute("data-expire-ts"));
          if (!Number.isFinite(expireTs)) return;
          var leftMs = expireTs - nowPlusSkew;
          var expired = leftMs <= 0;
          el.textContent = expired ? "Истекло" : "Осталось " + formatTimeLeftMs(leftMs);
          el.classList.toggle("admin-payment-card__countdown--expired", expired);
        });
    }

    paint();
    reservedUntilCountdownTimerId = setInterval(paint, 1000);
  }

  function setPaymentsTab(tab, root) {
    var t = tab === "pending" ? "pending" : "reserved";
    root.querySelectorAll("[data-payments-tab]").forEach(function (btn) {
      var on = btn.getAttribute("data-payments-tab") === t;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    root.querySelectorAll("[data-payments-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-payments-panel") !== t;
    });
  }

  function bindPaymentsTabs(root) {
    root.querySelectorAll("[data-payments-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.getAttribute("data-payments-tab");
        if (tab) setPaymentsTab(tab, root);
      });
    });
  }

  function updatePaymentTabBadges(root) {
    var nRes = root.querySelectorAll('[data-payments-panel="reserved"] .admin-payment-card').length;
    var nPen = root.querySelectorAll('[data-payments-panel="pending"] .admin-payment-card').length;
    var elR = root.querySelector('[data-payments-count="reserved"]');
    var elP = root.querySelector('[data-payments-count="pending"]');
    if (elR) elR.textContent = String(nRes);
    if (elP) elP.textContent = String(nPen);
  }

  function bindChatHandlers(container, token) {
    container.querySelectorAll("[data-chat-user]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var uid = Number(btn.getAttribute("data-chat-user"));
        if (!Number.isFinite(uid)) return;
        if (typeof window.abAdminOpenSupportChat === "function") {
          window.abAdminOpenSupportChat(uid);
        }
      });
    });
    container.querySelectorAll("[data-confirm-order]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-confirm-order"));
        confirmOrReject(token, id, "confirm");
      });
    });
    container.querySelectorAll("[data-reject-order]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-reject-order"));
        confirmOrReject(token, id, "reject");
      });
    });
    container.querySelectorAll("[data-release-order]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-release-order"));
        releaseOrder(token, id);
      });
    });
  }

  function removeOrderCardFromView(orderId) {
    var id = Number(orderId);
    if (!Number.isFinite(id)) return;
    var card = document.querySelector('.admin-payment-card[data-order-id="' + String(id) + '"]');
    if (!card) return;
    var section = card.closest("[data-payments-section]");
    card.remove();
    var mainEl = document.getElementById("admin-payments-main");
    if (mainEl) updatePaymentTabBadges(mainEl);
    if (section) {
      var cardsLeft = section.querySelectorAll(".admin-payment-card").length;
      if (cardsLeft === 0) {
        var empty = section.querySelector(".admin-payments-section__empty-note");
        if (!empty) {
          var p = document.createElement("p");
          p.className = "admin-payments-section__empty-note";
          var kind = section.getAttribute("data-payments-section");
          p.textContent =
            kind === "pending"
              ? "Заявок с прикреплённым чеком в очереди сейчас нет."
              : "Нет активных броней без чека.";
          section.appendChild(p);
        }
      }
    }
  }

  function bindPaymentsReloadButton(container) {
    if (!container) return;
    var btn = container.querySelector("[data-admin-payments-reload]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      loadList();
    });
  }

  function loadList() {
    const listEl = document.getElementById("admin-payments-list");
    const tabsSlot = document.getElementById("admin-payments-tabs-slot");
    const mainEl = document.getElementById("admin-payments-main");
    if (!listEl) return;
    const s = loadSession();
    if (!s || !s.token) {
      if (tabsSlot) tabsSlot.innerHTML = "";
      listEl.innerHTML =
        '<div class="admin-payments-empty admin-payments-empty--soft"><p>Нет сессии</p></div>';
      return;
    }
    if (tabsSlot) tabsSlot.innerHTML = "";
    listEl.innerHTML =
      '<div class="admin-payments-skeleton" aria-busy="true">' +
      '<div class="admin-payments-skeleton__line"></div>' +
      '<div class="admin-payments-skeleton__line admin-payments-skeleton__line--short"></div>' +
      "</div>";
    fetch("/api/admin/raffle-payments", {
      headers: { Authorization: "Bearer " + s.token },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (x) {
        if (!x.ok) throw new Error(x.data.error || "Ошибка");
        const payments = x.data.payments || [];
        const active = x.data.active_orders || [];
        const serverTimeMs = x.data.server_time_ms;
        const skewHtml = renderServerSkewNote(serverTimeMs);

        if (!payments.length && !active.length) {
          if (tabsSlot) tabsSlot.innerHTML = "";
          listEl.innerHTML =
            skewHtml +
            '<div class="admin-payments-empty">' +
            '<div class="admin-payments-empty__illu">' +
            ICO.inbox +
            "</div>" +
            "<p class=\"admin-payments-empty__title\">Очередь пуста</p>" +
            "<p class=\"admin-payments-empty__hint\">Нет активных броней и заявок с чеками.</p>" +
            '<div class="admin-payments-empty__actions">' +
            '<button type="button" class="btn btn--secondary" data-admin-payments-reload>Обновить</button>' +
            "</div>" +
            "</div>";
          bindPaymentsReloadButton(listEl);
          return;
        }

        var nRes = active.length;
        var nPen = payments.length;
        var initialTab = nRes > 0 ? "reserved" : "pending";
        var tabsHtml = "";
        tabsHtml += '<div class="admin-payments-tabs" role="tablist" aria-label="Тип заявок">';
        tabsHtml +=
          '<button type="button" class="admin-payments-tab' +
          (initialTab === "reserved" ? " is-active" : "") +
          '" data-payments-tab="reserved" role="tab" aria-selected="' +
          (initialTab === "reserved" ? "true" : "false") +
          '">Бронь без чека <span class="admin-payments-tab__badge" data-payments-count="reserved">' +
          String(nRes) +
          "</span></button>";
        tabsHtml +=
          '<button type="button" class="admin-payments-tab' +
          (initialTab === "pending" ? " is-active" : "") +
          '" data-payments-tab="pending" role="tab" aria-selected="' +
          (initialTab === "pending" ? "true" : "false") +
          '">На подтверждение <span class="admin-payments-tab__badge" data-payments-count="pending">' +
          String(nPen) +
          "</span></button>";
        tabsHtml += "</div>";

        var panelsHtml = "";
        panelsHtml += '<div class="admin-payments-panels">';
        panelsHtml +=
          '<div class="admin-payments-tabpanel" data-payments-panel="reserved" role="tabpanel"' +
          (initialTab !== "reserved" ? " hidden" : "") +
          ">";
        panelsHtml +=
          '<div class="admin-payments-section admin-payments-cards-grid" data-payments-section="reserved">';
        if (active.length) {
          panelsHtml += active.map(renderActiveCard).join("");
        } else {
          panelsHtml += '<p class="admin-payments-section__empty-note">Нет активных броней без чека.</p>';
        }
        panelsHtml += "</div></div>";
        panelsHtml +=
          '<div class="admin-payments-tabpanel" data-payments-panel="pending" role="tabpanel"' +
          (initialTab !== "pending" ? " hidden" : "") +
          ">";
        panelsHtml +=
          '<div class="admin-payments-section admin-payments-cards-grid" data-payments-section="pending">';
        if (payments.length) {
          panelsHtml += payments.map(renderPaymentCard).join("");
        } else {
          panelsHtml +=
            '<p class="admin-payments-section__empty-note">Заявок с прикреплённым чеком в очереди сейчас нет.</p>';
        }
        panelsHtml += "</div></div></div>";

        if (tabsSlot) tabsSlot.innerHTML = skewHtml + tabsHtml;
        listEl.innerHTML = panelsHtml;
        var rootForTabs = mainEl || listEl;
        bindPaymentsTabs(rootForTabs);
        bindChatHandlers(listEl, s.token);
        initReservedUntilCountdown(serverTimeMs);
      })
      .catch(function (e) {
        var ts = document.getElementById("admin-payments-tabs-slot");
        if (ts) ts.innerHTML = "";
        listEl.innerHTML =
          '<div class="admin-payments-empty admin-payments-empty--error">' +
          '<div class="admin-payments-empty__illu admin-payments-empty__illu--warn">' +
          ICO.inbox +
          "</div>" +
          "<p class=\"admin-payments-empty__title\">Не удалось загрузить</p>" +
          "<p class=\"admin-payments-empty__hint\">" +
          esc(String(e.message || "Ошибка")) +
          "</p>" +
          '<div class="admin-payments-empty__actions">' +
          '<button type="button" class="btn btn--secondary" data-admin-payments-reload>Обновить</button>' +
          "</div>" +
          "</div>";
        bindPaymentsReloadButton(listEl);
      });
  }

  function renderActiveCard(p) {
    const id = String(p.id);
    var uid = p.user_id != null ? Number(p.user_id) : NaN;
    var chatBtn =
      Number.isFinite(uid) && uid > 0
        ? '<button type="button" class="admin-payment-btn admin-payment-btn--chat" data-chat-user="' +
          String(uid) +
          '">' +
          ICO.chat +
          "<span>Написать в чат</span></button>"
        : "";
    const bankLabel =
      p.bank === "sber" ? "Сбербанк" : p.bank === "other" ? "Другой банк" : "—";
    return (
      '<article class="admin-payment-card admin-payment-card--active" data-order-id="' +
      id +
      '">' +
      '<div class="admin-payment-card__stripe admin-payment-card__stripe--amber" aria-hidden="true"></div>' +
      '<div class="admin-payment-card__body">' +
      '<header class="admin-payment-card__header">' +
      '<div class="admin-payment-card__raffle">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--violet">' +
      ICO.raffle +
      "</span>" +
      '<div class="admin-payment-card__raffle-text">' +
      '<span class="admin-payment-card__eyebrow">Бронь</span>' +
      '<h3 class="admin-payment-card__title">' +
      esc(String(p.raffle_title || "Без названия")) +
      "</h3>" +
      "</div></div>" +
      '<div class="admin-payment-card__sum-block">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--green">' +
      ICO.rub +
      "</span>" +
      '<div><span class="admin-payment-card__eyebrow">Сумма</span>' +
      '<p class="admin-payment-card__sum">' +
      esc(String(p.amount_rub ?? 0)) +
      " <span class=\"admin-payment-card__currency\">₽</span></p></div></div></header>" +
      '<ul class="admin-payment-card__facts">' +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--teal">' +
      ICO.time +
      "</span>" +
      "<span><strong>Создано</strong> · " +
      esc(formatOrderCreatedLocal(p.created_at)) +
      " <span class=\"admin-payment-card__tz-hint\">(ваш часовой пояс)</span></span></li>" +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--teal">' +
      ICO.time +
      "</span>" +
      "<span><strong>Бронь до</strong> · " +
      esc(formatOrderCreatedLocal(p.reserved_until)) +
      ' · <span class="admin-payment-card__countdown" data-expire-ts="' +
      String(p.reserved_until) +
      '"></span></span></li>' +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--blue">' +
      ICO.user +
      "</span>" +
      "<span>" +
      esc(String(p.user_name || "—")) +
      " · " +
      esc(String(p.user_phone || "")) +
      "</span></li>" +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--amber">' +
      ICO.tickets +
      "</span>" +
      "<span><strong>" +
      String(p.ticket_count ?? 0) +
      "</strong> номерков</span></li>" +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--slate">' +
      ICO.bank +
      "</span>" +
      "<span>" +
      esc(bankLabel) +
      "</span></li>" +
      rejectMetaFacts(p) +
      "</ul>" +
      '<div class="admin-payment-card__actions">' +
      chatBtn +
      '<button type="button" class="admin-payment-btn admin-payment-btn--release" data-release-order="' +
      id +
      '">' +
      ICO.unlock +
      "<span>Снять бронь полностью</span></button>" +
      "</div></div></article>"
    );
  }

  function rejectMetaFacts(p) {
    var n = Number(p.receipt_reject_count || 0);
    var note = p.last_reject_comment != null ? String(p.last_reject_comment).trim() : "";
    if (!n && !note) return "";
    var lines = "";
    if (n > 0) {
      lines +=
        '<li class="admin-payment-card__fact admin-payment-card__fact--warn">' +
        '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--amber">' +
        ICO.x +
        "</span>" +
        "<span><strong>Отклонений чека</strong> · " +
        esc(String(n)) +
        "</span></li>";
    }
    if (note) {
      lines +=
        '<li class="admin-payment-card__fact admin-payment-card__fact--note">' +
        '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--slate">' +
        ICO.receipt +
        "</span>" +
        "<span><strong>Последний комментарий</strong> · " +
        esc(note) +
        "</span></li>";
    }
    return lines;
  }

  function renderPaymentCard(p) {
    const receipt = p.receipt_url
      ? '<a href="' +
        esc(String(p.receipt_url)) +
        '" target="_blank" rel="noopener noreferrer" class="admin-payment-card__receipt-link">' +
        ICO.receipt +
        "<span>Открыть чек</span>" +
        '<span class="admin-payment-card__receipt-arrow" aria-hidden="true">↗</span></a>'
      : '<span class="admin-payment-card__receipt-miss">' +
        ICO.receipt +
        "<span>Чек не прикреплён</span></span>";
    const bankLabel =
      p.bank === "sber" ? "Сбербанк" : p.bank === "other" ? "Другой банк" : "—";
    const id = String(p.id);
    var uid = p.user_id != null ? Number(p.user_id) : NaN;
    var chatBtn =
      Number.isFinite(uid) && uid > 0
        ? '<button type="button" class="admin-payment-btn admin-payment-btn--chat" data-chat-user="' +
          String(uid) +
          '">' +
          ICO.chat +
          "<span>Написать в чат</span></button>"
        : "";
    var sameReceiptFact = Number(p.receipt_same_as_previous || 0)
      ? '<li class="admin-payment-card__fact admin-payment-card__fact--warn">' +
        '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--amber">' +
        ICO.receipt +
        "</span>" +
        "<span><strong>Внимание</strong> · загружен тот же файл чека, что и в прошлый раз</span></li>"
      : "";
    return (
      '<article class="admin-payment-card" data-order-id="' +
      id +
      '">' +
      '<div class="admin-payment-card__stripe" aria-hidden="true"></div>' +
      '<div class="admin-payment-card__body">' +
      '<header class="admin-payment-card__header">' +
      '<div class="admin-payment-card__raffle">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--violet">' +
      ICO.raffle +
      "</span>" +
      '<div class="admin-payment-card__raffle-text">' +
      '<span class="admin-payment-card__eyebrow">На проверке</span>' +
      '<h3 class="admin-payment-card__title">' +
      esc(String(p.raffle_title || "Без названия")) +
      "</h3>" +
      "</div></div>" +
      '<div class="admin-payment-card__sum-block">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--green">' +
      ICO.rub +
      "</span>" +
      '<div><span class="admin-payment-card__eyebrow">Сумма</span>' +
      '<p class="admin-payment-card__sum">' +
      esc(String(p.amount_rub ?? 0)) +
      " <span class=\"admin-payment-card__currency\">₽</span></p></div></div></header>" +
      '<ul class="admin-payment-card__facts">' +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--teal">' +
      ICO.time +
      "</span>" +
      "<span><strong>Создано</strong> · " +
      esc(formatOrderCreatedLocal(p.created_at)) +
      " <span class=\"admin-payment-card__tz-hint\">(ваш часовой пояс)</span></span></li>" +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--blue">' +
      ICO.user +
      "</span>" +
      "<span>" +
      esc(String(p.user_name || "—")) +
      " · " +
      esc(String(p.user_phone || "")) +
      "</span></li>" +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--amber">' +
      ICO.tickets +
      "</span>" +
      "<span><strong>" +
      String(p.ticket_count ?? 0) +
      "</strong> номерков</span></li>" +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--slate">' +
      ICO.bank +
      "</span>" +
      "<span>" +
      esc(bankLabel) +
      "</span></li>" +
      '<li class="admin-payment-card__fact admin-payment-card__fact--receipt">' +
      receipt +
      "</li>" +
      sameReceiptFact +
      rejectMetaFacts(p) +
      "</ul>" +
      '<div class="admin-payment-card__actions">' +
      chatBtn +
      '<button type="button" class="admin-payment-btn admin-payment-btn--confirm" data-confirm-order="' +
      id +
      '">' +
      ICO.check +
      "<span>Подтвердить</span></button>" +
      '<button type="button" class="admin-payment-btn admin-payment-btn--reject" data-reject-order="' +
      id +
      '">' +
      ICO.x +
      "<span>Отклонить чек</span></button>" +
      '<button type="button" class="admin-payment-btn admin-payment-btn--release" data-release-order="' +
      id +
      '">' +
      ICO.unlock +
      "<span>Снять бронь полностью</span></button>" +
      "</div></div></article>"
    );
  }

  async function confirmOrReject(token, orderId, kind) {
    const msg =
      kind === "confirm"
        ? "Подтвердить оплату и закрепить номерки за пользователем?"
        : "Чек не принят: заявка вернётся в бронь (или будет полностью отменена, если исчерпан лимит доработок). Продолжить?";
    if (!window.confirm(msg)) return;
    var comment = "";
    if (kind === "reject") {
      comment =
        window.prompt(
          "Комментарий для пользователя (необязательно). Попадёт в письмо и в историю заказа:",
          "",
        ) || "";
    }
    const path =
      kind === "confirm"
        ? "/api/admin/raffle-payments/" + String(orderId) + "/confirm"
        : "/api/admin/raffle-payments/" + String(orderId) + "/reject";
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ comment: String(comment).trim() }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "Ошибка");
      if (kind === "reject" && data.mode === "fully_released") {
        window.alert(
          "Лимит доработок исчерпан: заявка отменена полностью, номерки возвращены в продажу.",
        );
      }
      removeOrderCardFromView(orderId);
    } catch (e) {
      window.alert(String(e.message || "Ошибка"));
    }
  }

  async function releaseOrder(token, orderId) {
    if (
      !window.confirm(
        "Снять бронь полностью? Номерки вернутся в продажу, заявка будет отменена. Пользователь получит письмо (если настроен SMTP).",
      )
    )
      return;
    const comment =
      window.prompt("Комментарий пользователю (необязательно, будет в письме):", "") || "";
    try {
      const res = await fetch("/api/admin/raffle-orders/" + String(orderId) + "/release", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ comment: String(comment).trim() }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "Ошибка");
      removeOrderCardFromView(orderId);
    } catch (e) {
      window.alert(String(e.message || "Ошибка"));
    }
  }

  window.abInitPayments = function () {
    loadList();
  };
})();
