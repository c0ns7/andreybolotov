(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";
  const HISTORY_CLEARED_BEFORE_KEY = "ab_admin_payments_history_cleared_before_v1";

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
    copy:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
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

  function phoneDigitsOnly(raw) {
    return String(raw || "").replace(/\D/g, "");
  }

  var phoneCopyResetTimers = new WeakMap();

  function copyTextToClipboard(text, onDone) {
    var value = String(text || "");
    if (!value) return;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard
        .writeText(value)
        .then(onDone)
        .catch(function () {
          copyTextToClipboardFallback(value, onDone);
        });
      return;
    }
    copyTextToClipboardFallback(value, onDone);
  }

  function copyTextToClipboardFallback(text, onDone) {
    try {
      var ta = document.createElement("textarea");
      ta.value = String(text || "");
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      if (onDone) onDone();
    } catch {
      /* ignore */
    }
  }

  function renderUserPhoneFact(p, opts) {
    opts = opts || {};
    var showCopy = opts.showCopy === true;
    var digits = phoneDigitsOnly(p.user_phone);
    var copyBtn =
      showCopy && digits
        ? '<button type="button" class="admin-payment-phone-copy" data-copy-phone="' +
          esc(digits) +
          '" aria-label="Скопировать номер телефона" title="Скопировать номер">' +
          '<span class="admin-payment-phone-copy__ico admin-payment-phone-copy__ico--copy">' +
          ICO.copy +
          "</span>" +
          '<span class="admin-payment-phone-copy__ico admin-payment-phone-copy__ico--done">' +
          ICO.check +
          "</span></button>"
        : "";
    return (
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--blue">' +
      ICO.user +
      "</span>" +
      '<span class="admin-payment-phone-line">' +
      '<span class="admin-payment-phone-line__text">' +
      esc(String(p.user_name || "—")) +
      " · " +
      esc(String(p.user_phone || "")) +
      "</span>" +
      copyBtn +
      "</span></li>"
    );
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

  /** Компактная дата для списка старых чеков */
  function formatReceiptHistoryLocal(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "—";
    return new Date(n).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderPendingReceiptHistory(p) {
    var items = Array.isArray(p.receipt_history_prior) ? p.receipt_history_prior : [];
    if (!items.length) return "";
    var rows = items
      .map(function (it) {
        var oid = esc(String(it.order_public_id != null ? it.order_public_id : "A" + String(it.order_id)));
        var when = esc(formatReceiptHistoryLocal(it.at_ms));
        var name = esc(String(it.name || "чек"));
        var url = esc(String(it.url || "").trim());
        if (!url) return "";
        var tag = it.same_order
          ? '<span class="admin-payment-rhist__tag" title="Другая попытка по этой же заявке">та же заявка</span>'
          : "";
        return (
          '<li class="admin-payment-rhist__item">' +
          '<span class="admin-payment-rhist__meta">' +
          when +
          " · " +
          oid +
          (tag ? " " + tag : "") +
          "</span>" +
          '<a class="admin-payment-rhist__link" href="' +
          url +
          '" target="_blank" rel="noopener noreferrer">' +
          ICO.receipt +
          '<span class="admin-payment-rhist__fname">' +
          name +
          "</span>" +
          '<span class="admin-payment-rhist__go" aria-hidden="true">↗</span></a></li>'
        );
      })
      .filter(Boolean)
      .join("");
    if (!rows) return "";
    return (
      '<div class="admin-payment-rhist" role="region" aria-label="Ранее отправленные чеки по этой акции">' +
      '<div class="admin-payment-rhist__head">' +
      ICO.receipt +
      '<span class="admin-payment-rhist__title">Ранее по акции</span>' +
      '<span class="admin-payment-rhist__hint">другие заказы и старые файлы</span>' +
      "</div>" +
      '<ul class="admin-payment-rhist__list">' +
      rows +
      "</ul></div>"
    );
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
  var paymentsHistoryObserver = null;
  var paymentsHistoryLoading = false;

  function getHistoryClearedBeforeTs() {
    try {
      var raw = localStorage.getItem(HISTORY_CLEARED_BEFORE_KEY);
      var n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  }

  function setHistoryClearedBeforeTs(ts) {
    var n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return;
    try {
      localStorage.setItem(HISTORY_CLEARED_BEFORE_KEY, String(Math.floor(n)));
    } catch {}
  }

  function filterHistoryRows(rows) {
    var cutoff = getHistoryClearedBeforeTs();
    var list = Array.isArray(rows) ? rows : [];
    if (!cutoff) return list;
    return list.filter(function (row) {
      var createdAt = Number(row && row.created_at);
      if (!Number.isFinite(createdAt) || createdAt <= 0) return true;
      return createdAt > cutoff;
    });
  }

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
    var t = tab === "pending" || tab === "history" ? tab : "reserved";
    root.querySelectorAll("[data-payments-tab]").forEach(function (btn) {
      var on = btn.getAttribute("data-payments-tab") === t;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    root.querySelectorAll("[data-payments-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-payments-panel") !== t;
    });
    var historyTools = root.querySelector("[data-payments-history-tools]");
    if (historyTools) historyTools.hidden = t !== "history";
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
    var nHist = root.querySelectorAll('[data-payments-panel="history"] .admin-payment-card').length;
    var nHistTotal = Number(root.getAttribute("data-history-total"));
    var useHist = Number.isFinite(nHistTotal) && nHistTotal >= 0 ? Math.floor(nHistTotal) : nHist;
    var elR = root.querySelector('[data-payments-count="reserved"]');
    var elP = root.querySelector('[data-payments-count="pending"]');
    var elH = root.querySelector('[data-payments-count="history"]');
    if (elR) elR.textContent = String(nRes);
    if (elP) elP.textContent = String(nPen);
    if (elH) elH.textContent = String(useHist);
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
    bindPhoneCopyHandlers(container);
  }

  function bindPhoneCopyHandlers(container) {
    container.querySelectorAll("[data-copy-phone]").forEach(function (btn) {
      if (btn.getAttribute("data-phone-copy-bound") === "1") return;
      btn.setAttribute("data-phone-copy-bound", "1");
      btn.addEventListener("click", function () {
        var digits = btn.getAttribute("data-copy-phone") || "";
        if (!digits) return;
        copyTextToClipboard(digits, function () {
          btn.classList.add("admin-payment-phone-copy--copied");
          var prev = phoneCopyResetTimers.get(btn);
          if (prev) clearTimeout(prev);
          var t = setTimeout(function () {
            btn.classList.remove("admin-payment-phone-copy--copied");
            phoneCopyResetTimers.delete(btn);
          }, 3000);
          phoneCopyResetTimers.set(btn, t);
        });
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

  function bindHistoryClearActions(root) {
    if (!root) return;
    var clearBtn = root.querySelector("[data-admin-payments-history-clear]");
    if (clearBtn && clearBtn.getAttribute("data-bound-history-clear") !== "1") {
      clearBtn.setAttribute("data-bound-history-clear", "1");
      clearBtn.addEventListener("click", function () {
        if (!window.confirm("Очистить список в табе «История платежей»? Данные в базе не удаляются.")) return;
        setHistoryClearedBeforeTs(Date.now());
        loadList();
      });
    }
  }

  function unbindHistoryInfiniteScroll() {
    if (paymentsHistoryObserver) {
      try {
        paymentsHistoryObserver.disconnect();
      } catch {}
      paymentsHistoryObserver = null;
    }
    paymentsHistoryLoading = false;
  }

  function bindHistoryInfiniteScroll(opts) {
    var root = opts && opts.root ? opts.root : null;
    var token = opts && opts.token ? String(opts.token) : "";
    var initialHasMore = !!(opts && opts.hasMore);
    var nextOffset = Number(opts && opts.nextOffset);
    if (!root || !token) return;
    var section = root.querySelector('[data-payments-section="history"]');
    if (!section) return;
    var panel = section.closest('[data-payments-panel="history"]');
    if (!panel) panel = section.parentElement;
    unbindHistoryInfiniteScroll();
    if (!initialHasMore) return;
    var offset = Number.isFinite(nextOffset) ? Math.max(0, Math.floor(nextOffset)) : section.querySelectorAll(".admin-payment-card").length;
    var sentinel = document.createElement("div");
    sentinel.className = "admin-payments-history-sentinel";
    sentinel.setAttribute("data-history-sentinel", "1");
    sentinel.textContent = "Прокрутите вниз, чтобы загрузить еще...";
    panel.appendChild(sentinel);

    var loadMore = function () {
      if (paymentsHistoryLoading) return;
      paymentsHistoryLoading = true;
      sentinel.textContent = "Загружаем еще...";
      fetch(
        "/api/admin/raffle-payments/history?limit=10&offset=" + encodeURIComponent(String(offset)),
        {
          headers: { Authorization: "Bearer " + token },
          cache: "no-store",
        },
      )
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (x) {
          if (!x.ok) throw new Error((x.data && x.data.error) || "Ошибка");
          var rows = filterHistoryRows(Array.isArray(x.data.history) ? x.data.history : []);
          if (rows.length) {
            section.insertAdjacentHTML("beforeend", rows.map(renderPaymentHistoryCard).join(""));
            bindChatHandlers(section, token);
          }
          var nextOffsetRaw = Number(x.data.next_offset);
          offset = Number.isFinite(nextOffsetRaw) ? nextOffsetRaw : offset + rows.length;
          var hasMore = !!x.data.has_more;
          if (!hasMore || rows.length === 0) {
            sentinel.textContent = "Это вся история платежей.";
            unbindHistoryInfiniteScroll();
            return;
          }
          sentinel.textContent = "Прокрутите вниз, чтобы загрузить еще...";
          var mainEl = document.getElementById("admin-payments-main");
          if (mainEl) updatePaymentTabBadges(mainEl);
        })
        .catch(function () {
          sentinel.textContent = "Не удалось загрузить. Прокрутите еще раз.";
        })
        .finally(function () {
          paymentsHistoryLoading = false;
        });
    };

    paymentsHistoryObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) loadMore();
        });
      },
      {
        root: null,
        rootMargin: "220px 0px 220px 0px",
        threshold: 0.01,
      },
    );
    paymentsHistoryObserver.observe(sentinel);
  }

  function loadList() {
    const listEl = document.getElementById("admin-payments-list");
    const tabsSlot = document.getElementById("admin-payments-tabs-slot");
    const mainEl = document.getElementById("admin-payments-main");
    if (!listEl) return;
    unbindHistoryInfiniteScroll();
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
        const history = filterHistoryRows(x.data.history || []);
        const historyHasMore = !!x.data.history_has_more;
        const historyNextOffset = Number(x.data.history_next_offset ?? history.length);
        const serverTimeMs = x.data.server_time_ms;
        const skewHtml = renderServerSkewNote(serverTimeMs);

        if (!payments.length && !active.length && !history.length) {
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
        var historyTotalRaw = Number(x.data.history_total);
        var nHist = Number.isFinite(historyTotalRaw) && historyTotalRaw >= 0 ? Math.floor(historyTotalRaw) : history.length;
        var initialTab = nRes > 0 ? "reserved" : "pending";
        if (initialTab === "pending" && nPen === 0 && nHist > 0) initialTab = "history";
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
        tabsHtml +=
          '<button type="button" class="admin-payments-tab' +
          (initialTab === "history" ? " is-active" : "") +
          '" data-payments-tab="history" role="tab" aria-selected="' +
          (initialTab === "history" ? "true" : "false") +
          '">История платежей <span class="admin-payments-tab__badge" data-payments-count="history">' +
          String(nHist) +
          "</span></button>";
        tabsHtml += "</div>";
        tabsHtml +=
          '<div class="admin-payments-history-tools"' +
          ' data-payments-history-tools' +
          (initialTab !== "history" ? " hidden" : "") +
          ">";
        tabsHtml +=
          '<button type="button" class="admin-payments-history-clear-btn" data-admin-payments-history-clear>' +
          '<span class="admin-payments-history-clear-btn__ico" aria-hidden="true">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          "<polyline points=\"3 6 5 6 21 6\"></polyline><path d=\"M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6\"></path><path d=\"M10 11v6\"></path><path d=\"M14 11v6\"></path><path d=\"M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2\"></path>" +
          "</svg>" +
          "</span>" +
          "<span>Очистить все</span>" +
          "</button>";
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
        panelsHtml += "</div></div>";
        panelsHtml +=
          '<div class="admin-payments-tabpanel" data-payments-panel="history" role="tabpanel"' +
          (initialTab !== "history" ? " hidden" : "") +
          ">";
        panelsHtml +=
          '<div class="admin-payments-section admin-payments-cards-grid" data-payments-section="history">';
        if (history.length) {
          panelsHtml += history.map(renderPaymentHistoryCard).join("");
        } else {
          panelsHtml += '<p class="admin-payments-section__empty-note">История платежей пока пуста.</p>';
        }
        panelsHtml += "</div></div></div>";

        if (tabsSlot) tabsSlot.innerHTML = skewHtml + tabsHtml;
        listEl.innerHTML = panelsHtml;
        var rootForTabs = mainEl || listEl;
        rootForTabs.setAttribute("data-history-total", String(nHist));
        bindPaymentsTabs(rootForTabs);
        bindChatHandlers(listEl, s.token);
        bindHistoryClearActions(rootForTabs);
        bindHistoryInfiniteScroll({
          root: rootForTabs,
          token: s.token,
          hasMore: historyHasMore,
          nextOffset: historyNextOffset,
        });
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
      renderUserPhoneFact(p, { showCopy: true }) +
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
      renderPendingReceiptHistory(p) +
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

  function paymentStatusLabel(status) {
    var s = String(status || "");
    if (s === "confirmed") return "Закреплено";
    if (s === "pending_review") return "На проверке";
    if (s === "reserved") return "Бронь";
    if (s === "rejected") return "Отклонено / отменено";
    return s || "—";
  }

  function renderHistoryReceipts(items) {
    var list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return (
        '<div class="admin-payment-rhist" role="region" aria-label="Чеки по заявке">' +
        '<div class="admin-payment-rhist__head">' +
        ICO.receipt +
        '<span class="admin-payment-rhist__title">Чеки</span>' +
        '<span class="admin-payment-rhist__hint">не загружались</span>' +
        "</div></div>"
      );
    }
    var rows = list
      .map(function (it) {
        var when = esc(formatReceiptHistoryLocal(it.at_ms));
        var name = esc(String(it.name || "чек"));
        var url = esc(String(it.url || "").trim());
        if (!url) return "";
        return (
          '<li class="admin-payment-rhist__item">' +
          '<span class="admin-payment-rhist__meta">' +
          when +
          "</span>" +
          '<a class="admin-payment-rhist__link" href="' +
          url +
          '" target="_blank" rel="noopener noreferrer">' +
          ICO.receipt +
          '<span class="admin-payment-rhist__fname">' +
          name +
          "</span>" +
          '<span class="admin-payment-rhist__go" aria-hidden="true">↗</span></a></li>'
        );
      })
      .filter(Boolean)
      .join("");
    if (!rows) return "";
    return (
      '<div class="admin-payment-rhist" role="region" aria-label="Чеки по заявке">' +
      '<div class="admin-payment-rhist__head">' +
      ICO.receipt +
      '<span class="admin-payment-rhist__title">Чеки по заявке</span>' +
      '<span class="admin-payment-rhist__hint">все загрузки</span>' +
      "</div>" +
      '<ul class="admin-payment-rhist__list">' +
      rows +
      "</ul></div>"
    );
  }

  function renderPaymentHistoryCard(p) {
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
    var bankLabel = p.bank === "sber" ? "Сбербанк" : p.bank === "other" ? "Другой банк" : "—";
    var nums = Array.isArray(p.ticket_numbers) ? p.ticket_numbers : [];
    var numsLabel = nums.length ? esc(nums.join(", ")) : "—";
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
      '<span class="admin-payment-card__eyebrow">Заявка A' +
      esc(String(id)) +
      "</span>" +
      '<h3 class="admin-payment-card__title">' +
      esc(String(p.raffle_title || "Без названия")) +
      "</h3></div></div>" +
      '<div class="admin-payment-card__sum-block">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--green">' +
      ICO.rub +
      "</span>" +
      '<div><span class="admin-payment-card__eyebrow">Сумма</span>' +
      '<p class="admin-payment-card__sum">' +
      esc(String(p.amount_rub ?? 0)) +
      ' <span class="admin-payment-card__currency">₽</span></p></div></div></header>' +
      '<ul class="admin-payment-card__facts">' +
      '<li class="admin-payment-card__fact"><span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--teal">' +
      ICO.time +
      "</span><span><strong>Создано</strong> · " +
      esc(formatOrderCreatedLocal(p.created_at)) +
      ' <span class="admin-payment-card__tz-hint">(ваш часовой пояс)</span></span></li>' +
      '<li class="admin-payment-card__fact"><span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--blue">' +
      ICO.user +
      "</span><span>" +
      esc(String(p.user_name || "—")) +
      " · " +
      esc(String(p.user_phone || "")) +
      "</span></li>" +
      '<li class="admin-payment-card__fact"><span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--amber">' +
      ICO.tickets +
      "</span><span><strong>" +
      String(p.ticket_count ?? 0) +
      "</strong> номерков · " +
      numsLabel +
      "</span></li>" +
      '<li class="admin-payment-card__fact"><span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--slate">' +
      ICO.bank +
      "</span><span>" +
      esc(bankLabel) +
      " · " +
      esc(paymentStatusLabel(p.status)) +
      "</span></li>" +
      "</ul>" +
      renderHistoryReceipts(p.receipt_history) +
      '<div class="admin-payment-card__actions">' +
      chatBtn +
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
