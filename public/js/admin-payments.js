(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";
  const HISTORY_CLEARED_BEFORE_KEY = "ab_admin_payments_history_cleared_before_v1";
  const PAYMENTS_FILTER_PHONE_KEY = "ab_admin_payments_filter_phone_v1";
  const POLL_INTERVAL_MS = 45000;
  const COPY_DONE_MS = 3000;
  const TOAST_MS = 5000;
  const TICKETS_PREVIEW_MAX = 12;

  const REJECT_COMMENT_TEMPLATES = [
    { label: "Сумма не совпадает", text: "Сумма в чеке не совпадает с суммой заявки. Загрузите чек с правильной суммой." },
    { label: "Нечитаемый чек", text: "Чек нечитаемый или обрезан. Загрузите полный и чёткий скриншот/фото чека." },
    { label: "Не тот получатель", text: "В чеке указан другой получатель. Оплатите на реквизиты из инструкции акции." },
    { label: "Не тот банк", text: "Оплата выполнена не с того банка, который указан в заявке." },
  ];

  var paymentsRuntime = {
    token: "",
    cache: null,
    lastFetchAt: 0,
    pollTimer: null,
    updatedAgoTimer: null,
    knownPendingIds: new Set(),
    pendingNewCount: 0,
    receiptRejectMax: 3,
    filters: { q: "", sort: "queue_asc", raffle: "" },
    loading: false,
  };

  var copyResetTimers = new WeakMap();

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

  function renderCopyBtn(value, label) {
    var v = String(value || "").trim();
    if (!v) return "";
    return (
      '<button type="button" class="admin-payment-inline-copy" data-copy-value="' +
      esc(v) +
      '" aria-label="' +
      esc(label) +
      '" title="' +
      esc(label) +
      '">' +
      '<span class="admin-payment-inline-copy__ico admin-payment-inline-copy__ico--copy">' +
      ICO.copy +
      "</span>" +
      '<span class="admin-payment-inline-copy__ico admin-payment-inline-copy__ico--done">' +
      ICO.check +
      "</span></button>"
    );
  }

  function renderUserPhoneFact(p, opts) {
    opts = opts || {};
    var showCopy = opts.showCopy === true;
    var digits = phoneDigitsOnly(p.user_phone);
    var uid = p.user_id != null ? Number(p.user_id) : NaN;
    var profileLink =
      Number.isFinite(uid) && uid > 0
        ? '<a class="admin-payment-user-link" href="/admin?tab=users&amp;user_id=' +
          String(uid) +
          '">Профиль</a>'
        : "";
    var filterBtn =
      digits
        ? '<button type="button" class="admin-payment-user-link admin-payment-user-link--btn" data-payments-filter-phone="' +
          esc(digits) +
          '">Все заявки</button>'
        : "";
    var copyBtn = showCopy && digits ? renderCopyBtn(digits, "Скопировать номер телефона") : "";
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
      (profileLink || filterBtn
        ? '<span class="admin-payment-user-links">' + profileLink + filterBtn + "</span>"
        : "") +
      "</span></li>"
    );
  }

  function formatWaitHuman(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return "—";
    var sec = Math.floor(n / 1000);
    if (sec < 60) return sec + " с";
    var m = Math.floor(sec / 60);
    if (m < 60) return m + " мин";
    var h = Math.floor(m / 60);
    m = m % 60;
    if (h < 24) return h + " ч " + (m ? m + " мин" : "");
    var d = Math.floor(h / 24);
    h = h % 24;
    return d + " д " + (h ? h + " ч" : "");
  }

  function waitBadgeHtml(sinceMs) {
    var n = Number(sinceMs);
    if (!Number.isFinite(n) || n <= 0) return "";
    var waitMs = Math.max(0, Date.now() - n);
    var tier = waitMs < 30 * 60 * 1000 ? "ok" : waitMs < 2 * 60 * 60 * 1000 ? "warn" : "danger";
    return (
      '<span class="admin-payment-wait admin-payment-wait--' +
      tier +
      '" data-wait-since="' +
      String(n) +
      '">ждёт ' +
      esc(formatWaitHuman(waitMs)) +
      "</span>"
    );
  }

  function renderTicketsFact(p) {
    var nums = Array.isArray(p.ticket_numbers) ? p.ticket_numbers.map(function (x) { return Math.floor(Number(x)); }).filter(Number.isFinite) : [];
    var count = nums.length || Number(p.ticket_count ?? 0);
    var copyAll = nums.length ? renderCopyBtn(nums.join(", "), "Скопировать номера") : "";
    if (!nums.length) {
      return (
        '<li class="admin-payment-card__fact">' +
        '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--amber">' +
        ICO.tickets +
        "</span>" +
        "<span><strong>" +
        String(count) +
        "</strong> номерков</span></li>"
      );
    }
    var preview = nums.slice(0, TICKETS_PREVIEW_MAX).join(", ");
    var hasMore = nums.length > TICKETS_PREVIEW_MAX;
    var full = esc(nums.join(", "));
    return (
      '<li class="admin-payment-card__fact admin-payment-card__fact--tickets">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--amber">' +
      ICO.tickets +
      "</span>" +
      '<span class="admin-payment-tickets">' +
      "<span><strong>" +
      String(count) +
      "</strong> номерков</span> " +
      copyAll +
      '<div class="admin-payment-tickets__nums">' +
      '<span class="admin-payment-tickets__preview">' +
      esc(preview) +
      (hasMore ? "…" : "") +
      "</span>" +
      (hasMore
        ? '<button type="button" class="admin-payment-tickets__toggle" data-tickets-toggle data-label-show="Показать все (' +
          String(nums.length) +
          ')">Показать все (' +
          String(nums.length) +
          ")</button>" +
          '<div class="admin-payment-tickets__full" hidden>' +
          full +
          "</div>"
        : "") +
      "</div></span></li>"
    );
  }

  function findPreviousReceiptUrl(p) {
    var cur = String(p.receipt_url || "").trim();
    var prior = Array.isArray(p.receipt_history_prior) ? p.receipt_history_prior : [];
    for (var i = 0; i < prior.length; i++) {
      var url = String(prior[i].url || "").trim();
      if (url && url !== cur) return url;
    }
    return prior.length ? String(prior[0].url || "").trim() : "";
  }

  function renderDuplicateReceiptBanner(p) {
    if (!Number(p.receipt_same_as_previous || 0)) return "";
    var prevUrl = findPreviousReceiptUrl(p);
    var prevBtn = prevUrl
      ? '<button type="button" class="admin-payment-dup-banner__link" data-preview-receipt="' +
        esc(prevUrl) +
        '" data-receipt-mime="">Открыть прошлый чек</button>'
      : "";
    return (
      '<div class="admin-payment-dup-banner" role="alert">' +
      "<strong>Дубликат чека</strong> — загружен тот же файл, что и раньше. " +
      prevBtn +
      "</div>"
    );
  }

  function renderReceiptControl(p) {
    var url = String(p.receipt_url || "").trim();
    if (!url) {
      return (
        '<span class="admin-payment-card__receipt-miss">' +
        ICO.receipt +
        "<span>Чек не прикреплён</span></span>"
      );
    }
    var mime = esc(String(p.receipt_mime || ""));
    return (
      '<div class="admin-payment-receipt-actions">' +
      '<button type="button" class="admin-payment-card__receipt-link admin-payment-card__receipt-link--btn" data-preview-receipt="' +
      esc(url) +
      '" data-receipt-mime="' +
      mime +
      '">' +
      ICO.receipt +
      "<span>Превью чека</span></button>" +
      '<a href="' +
      esc(url) +
      '" target="_blank" rel="noopener noreferrer" class="admin-payment-card__receipt-ext">↗</a></div>'
    );
  }

  function showToast(message, kind) {
    var host = document.getElementById("admin-payments-toast-host");
    if (!host) return;
    var el = document.createElement("div");
    el.className = "admin-pay-toast admin-pay-toast--" + (kind || "ok");
    el.setAttribute("role", "status");
    el.textContent = String(message || "");
    host.appendChild(el);
    requestAnimationFrame(function () {
      el.classList.add("is-visible");
    });
    setTimeout(function () {
      el.classList.remove("is-visible");
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 280);
    }, TOAST_MS);
  }

  function closePaymentsModal() {
    var host = document.getElementById("admin-payments-modal-host");
    if (!host) return;
    host.hidden = true;
    host.setAttribute("aria-hidden", "true");
    host.innerHTML = "";
    document.body.classList.remove("admin-pay-modal-open");
  }

  function openPaymentsModal(innerHtml) {
    var host = document.getElementById("admin-payments-modal-host");
    if (!host) return;
    host.innerHTML =
      '<div class="admin-pay-modal">' +
      '<button type="button" class="admin-pay-modal__backdrop" data-pay-modal-close aria-label="Закрыть"></button>' +
      '<div class="admin-pay-modal__panel" role="dialog" aria-modal="true">' +
      innerHtml +
      "</div></div>";
    host.hidden = false;
    host.setAttribute("aria-hidden", "false");
    document.body.classList.add("admin-pay-modal-open");
    host.querySelectorAll("[data-pay-modal-close]").forEach(function (btn) {
      btn.addEventListener("click", closePaymentsModal);
    });
  }

  function openReceiptLightbox(url, mime) {
    var box = document.getElementById("admin-payments-receipt-lightbox");
    var body = box ? box.querySelector("[data-lightbox-body]") : null;
    var openTab = box ? box.querySelector(".admin-pay-lightbox__open-tab") : null;
    if (!box || !body) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    var u = String(url || "").trim();
    var m = String(mime || "").toLowerCase();
    var isPdf = m.indexOf("pdf") >= 0 || /\.pdf(\?|$)/i.test(u);
    body.innerHTML = "";
    if (isPdf) {
      body.innerHTML =
        '<iframe class="admin-pay-lightbox__iframe" src="' +
        esc(u) +
        '" title="Чек PDF"></iframe>';
    } else {
      body.innerHTML =
        '<img class="admin-pay-lightbox__img" src="' +
        esc(u) +
        '" alt="Чек" />';
    }
    if (openTab) {
      openTab.href = u;
      openTab.hidden = !u;
    }
    box.hidden = false;
    box.setAttribute("aria-hidden", "false");
    document.body.classList.add("admin-pay-lightbox-open");
  }

  function closeReceiptLightbox() {
    var box = document.getElementById("admin-payments-receipt-lightbox");
    if (!box) return;
    var body = box.querySelector("[data-lightbox-body]");
    if (body) body.innerHTML = "";
    box.hidden = true;
    box.setAttribute("aria-hidden", "true");
    document.body.classList.remove("admin-pay-lightbox-open");
  }

  function initReceiptLightboxOnce() {
    var box = document.getElementById("admin-payments-receipt-lightbox");
    if (!box || box.getAttribute("data-bound-lightbox") === "1") return;
    box.setAttribute("data-bound-lightbox", "1");
    box.querySelectorAll("[data-lightbox-close]").forEach(function (btn) {
      btn.addEventListener("click", closeReceiptLightbox);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !box.hidden) closeReceiptLightbox();
    });
  }

  function renderRejectTemplatesHtml() {
    return REJECT_COMMENT_TEMPLATES.map(function (t) {
      return (
        '<button type="button" class="admin-pay-modal__chip" data-reject-template="' +
        esc(t.text) +
        '">' +
        esc(t.label) +
        "</button>"
      );
    }).join("");
  }

  function openConfirmModal(token, orderId) {
    if (!Number.isFinite(orderId)) return;
    openPaymentsModal(
      '<header class="admin-pay-modal__head"><h2 class="admin-pay-modal__title">Подтвердить оплату</h2></header>' +
        '<p class="admin-pay-modal__text">Закрепить номерки за пользователем по заявке <strong>A' +
        esc(String(orderId)) +
        "</strong>?</p>" +
        '<footer class="admin-pay-modal__foot">' +
        '<button type="button" class="btn btn--ghost" data-pay-modal-close>Отмена</button>' +
        '<button type="button" class="btn btn--primary" data-pay-modal-submit="confirm" data-order-id="' +
        String(orderId) +
        '">Подтвердить</button></footer>',
    );
    var host = document.getElementById("admin-payments-modal-host");
    if (!host) return;
    host.querySelector("[data-pay-modal-submit]").addEventListener("click", function () {
      closePaymentsModal();
      submitConfirm(token, orderId);
    });
  }

  function openRejectModal(token, orderId) {
    if (!Number.isFinite(orderId)) return;
    openPaymentsModal(
      '<header class="admin-pay-modal__head"><h2 class="admin-pay-modal__title">Отклонить чек</h2></header>' +
        '<p class="admin-pay-modal__text">Заявка вернётся в бронь или будет отменена при исчерпании лимита доработок.</p>' +
        '<div class="admin-pay-modal__chips">' +
        renderRejectTemplatesHtml() +
        "</div>" +
        '<label class="admin-pay-modal__label">Комментарий для пользователя <span class="admin-pay-modal__opt">(необязательно)</span></label>' +
        '<textarea class="input admin-pay-modal__textarea" rows="4" data-reject-comment placeholder="Причина отклонения…"></textarea>' +
        '<footer class="admin-pay-modal__foot">' +
        '<button type="button" class="btn btn--ghost" data-pay-modal-close>Отмена</button>' +
        '<button type="button" class="btn btn--danger-outline" data-pay-modal-submit="reject" data-order-id="' +
        String(orderId) +
        '">Отклонить чек</button></footer>',
    );
    var host = document.getElementById("admin-payments-modal-host");
    if (!host) return;
    var ta = host.querySelector("[data-reject-comment]");
    host.querySelectorAll("[data-reject-template]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        if (ta) ta.value = chip.getAttribute("data-reject-template") || "";
      });
    });
    host.querySelector("[data-pay-modal-submit]").addEventListener("click", function () {
      var comment = ta ? String(ta.value || "").trim() : "";
      closePaymentsModal();
      submitReject(token, orderId, comment);
    });
  }

  function openReleaseModal(token, orderId) {
    if (!Number.isFinite(orderId)) return;
    openPaymentsModal(
      '<header class="admin-pay-modal__head"><h2 class="admin-pay-modal__title">Снять бронь полностью</h2></header>' +
        '<p class="admin-pay-modal__text admin-pay-modal__text--warn">Номерки вернутся в продажу, заявка будет отменена. Пользователь получит уведомление.</p>' +
        '<footer class="admin-pay-modal__foot">' +
        '<button type="button" class="btn btn--ghost" data-pay-modal-close>Отмена</button>' +
        '<button type="button" class="btn btn--danger-outline" data-pay-modal-step="1" data-order-id="' +
        String(orderId) +
        '">Продолжить</button></footer>',
    );
    var host = document.getElementById("admin-payments-modal-host");
    if (!host) return;
    host.querySelector("[data-pay-modal-step]").addEventListener("click", function () {
      openReleaseModalStep2(token, orderId);
    });
  }

  function openReleaseModalStep2(token, orderId) {
    openPaymentsModal(
      '<header class="admin-pay-modal__head"><h2 class="admin-pay-modal__title">Подтвердите отмену</h2></header>' +
        '<p class="admin-pay-modal__text">Это действие нельзя отменить. Заявка <strong>A' +
        esc(String(orderId)) +
        "</strong> будет снята.</p>" +
        '<label class="admin-pay-modal__label">Комментарий <span class="admin-pay-modal__opt">(необязательно)</span></label>' +
        '<textarea class="input admin-pay-modal__textarea" rows="3" data-release-comment></textarea>' +
        '<footer class="admin-pay-modal__foot">' +
        '<button type="button" class="btn btn--ghost" data-pay-modal-close>Назад</button>' +
        '<button type="button" class="btn btn--danger" data-pay-modal-submit="release" data-order-id="' +
        String(orderId) +
        '">Снять бронь</button></footer>',
    );
    var host = document.getElementById("admin-payments-modal-host");
    if (!host) return;
    host.querySelector("[data-pay-modal-submit]").addEventListener("click", function () {
      var ta = host.querySelector("[data-release-comment]");
      var comment = ta ? String(ta.value || "").trim() : "";
      closePaymentsModal();
      submitRelease(token, orderId, comment);
    });
  }

  function setCardBusy(orderId, busy) {
    var card = document.querySelector('.admin-payment-card[data-order-id="' + String(orderId) + '"]');
    if (!card) return;
    card.classList.toggle("admin-payment-card--busy", !!busy);
    card.querySelectorAll("button").forEach(function (btn) {
      btn.disabled = !!busy;
    });
  }

  function paintWaitBadges() {
    document.querySelectorAll(".admin-payment-wait[data-wait-since]").forEach(function (el) {
      var since = Number(el.getAttribute("data-wait-since"));
      if (!Number.isFinite(since)) return;
      var waitMs = Math.max(0, Date.now() - since);
      var tier = waitMs < 30 * 60 * 1000 ? "ok" : waitMs < 2 * 60 * 60 * 1000 ? "warn" : "danger";
      el.classList.remove("admin-payment-wait--ok", "admin-payment-wait--warn", "admin-payment-wait--danger");
      el.classList.add("admin-payment-wait--" + tier);
      el.textContent = "ждёт " + formatWaitHuman(waitMs);
    });
  }

  function updateReloadStatusText() {
    var el = document.querySelector("[data-payments-updated-ago]");
    if (!el || !paymentsRuntime.lastFetchAt) return;
    var sec = Math.max(0, Math.floor((Date.now() - paymentsRuntime.lastFetchAt) / 1000));
    el.textContent = sec < 5 ? "только что" : "обновлено " + sec + " с назад";
  }

  function startUpdatedAgoTimer() {
    if (paymentsRuntime.updatedAgoTimer) clearInterval(paymentsRuntime.updatedAgoTimer);
    updateReloadStatusText();
    paymentsRuntime.updatedAgoTimer = setInterval(updateReloadStatusText, 1000);
  }

  function stopPaymentsPoll() {
    if (paymentsRuntime.pollTimer) {
      clearInterval(paymentsRuntime.pollTimer);
      paymentsRuntime.pollTimer = null;
    }
  }

  function countPendingInCache() {
    if (!paymentsRuntime.cache || !Array.isArray(paymentsRuntime.cache.payments)) return 0;
    return paymentsRuntime.cache.payments.length;
  }

  function removeOrderFromPaymentsCache(orderId) {
    var id = Number(orderId);
    if (!Number.isFinite(id) || !paymentsRuntime.cache) return;
    if (Array.isArray(paymentsRuntime.cache.payments)) {
      paymentsRuntime.cache.payments = paymentsRuntime.cache.payments.filter(function (p) {
        return Number(p.id) !== id;
      });
    }
    if (paymentsRuntime.knownPendingIds) paymentsRuntime.knownPendingIds.delete(String(id));
  }

  function removeOrderFromActiveCache(orderId) {
    var id = Number(orderId);
    if (!Number.isFinite(id) || !paymentsRuntime.cache) return;
    if (Array.isArray(paymentsRuntime.cache.active)) {
      paymentsRuntime.cache.active = paymentsRuntime.cache.active.filter(function (p) {
        return Number(p.id) !== id;
      });
    }
  }

  function updatePaymentsCountBadges() {
    var nRes =
      paymentsRuntime.cache && paymentsRuntime.cache.active ? paymentsRuntime.cache.active.length : 0;
    var nPen = countPendingInCache();
    var elR = document.querySelector('[data-payments-count="reserved"]');
    var elP = document.querySelector('[data-payments-count="pending"]');
    if (elR) elR.textContent = String(nRes);
    if (elP) elP.textContent = String(nPen);
  }

  function syncPaymentsPoll() {
    if (countPendingInCache() > 0) stopPaymentsPoll();
    else startPaymentsPoll();
  }

  function startPaymentsPoll() {
    stopPaymentsPoll();
    paymentsRuntime.pollTimer = setInterval(function () {
      pollPaymentsQueue();
    }, POLL_INTERVAL_MS);
  }

  function paymentMatchesFilter(p, section) {
    var q = String(paymentsRuntime.filters.q || "").trim().toLowerCase();
    if (!q) return true;
    var idStr = "a" + String(p.id);
    var phone = phoneDigitsOnly(p.user_phone);
    var hay =
      (p.user_name || "") +
      " " +
      (p.user_phone || "") +
      " " +
      phone +
      " " +
      (p.raffle_title || "") +
      " " +
      idStr +
      " " +
      String(p.amount_rub ?? "");
    return hay.toLowerCase().indexOf(q) >= 0;
  }

  function sortPaymentsList(list, sortKey) {
    var arr = (Array.isArray(list) ? list : []).slice();
    var sk = sortKey || "queue_asc";
    arr.sort(function (a, b) {
      if (sk === "amount_desc") return Number(b.amount_rub) - Number(a.amount_rub);
      if (sk === "amount_asc") return Number(a.amount_rub) - Number(b.amount_rub);
      if (sk === "receipt_desc") return Number(b.updated_at || 0) - Number(a.updated_at || 0);
      if (sk === "receipt_asc") return Number(a.updated_at || 0) - Number(b.updated_at || 0);
      if (sk === "raffle") {
        var t = String(a.raffle_title || "").localeCompare(String(b.raffle_title || ""), "ru");
        if (t) return t;
      }
      return Number(a.created_at || 0) - Number(b.created_at || 0);
    });
    return arr;
  }

  function getFilteredPending() {
    var list = paymentsRuntime.cache && paymentsRuntime.cache.payments ? paymentsRuntime.cache.payments : [];
    var raffle = String(paymentsRuntime.filters.raffle || "");
    return sortPaymentsList(
      list.filter(function (p) {
        if (raffle && String(p.raffle_id) !== raffle) return false;
        return paymentMatchesFilter(p, "pending");
      }),
      paymentsRuntime.filters.sort,
    );
  }

  function getFilteredReserved() {
    var list = paymentsRuntime.cache && paymentsRuntime.cache.active ? paymentsRuntime.cache.active : [];
    return sortPaymentsList(
      list.filter(function (p) {
        return paymentMatchesFilter(p, "reserved");
      }),
      paymentsRuntime.filters.sort,
    );
  }

  function rerenderPendingSection() {
    var section = document.querySelector('[data-payments-section="pending"]');
    if (!section || !paymentsRuntime.token) return;
    var rows = getFilteredPending();
    section.innerHTML = rows.length
      ? rows.map(renderPaymentCard).join("")
      : '<p class="admin-payments-section__empty-note">Заявок с прикреплённым чеком в очереди сейчас нет.</p>';
    bindPaymentsCardHandlers(section, paymentsRuntime.token);
    var mainEl = document.getElementById("admin-payments-main");
    if (mainEl) updatePaymentTabBadges(mainEl);
  }

  function rerenderReservedSection() {
    var section = document.querySelector('[data-payments-section="reserved"]');
    if (!section || !paymentsRuntime.token) return;
    var rows = getFilteredReserved();
    section.innerHTML = rows.length
      ? rows.map(renderActiveCard).join("")
      : '<p class="admin-payments-section__empty-note">Нет активных броней без чека.</p>';
    bindPaymentsCardHandlers(section, paymentsRuntime.token);
    var mainEl = document.getElementById("admin-payments-main");
    if (mainEl) updatePaymentTabBadges(mainEl);
    if (paymentsRuntime.cache && paymentsRuntime.cache.serverTimeMs != null) {
      initReservedUntilCountdown(paymentsRuntime.cache.serverTimeMs);
    }
  }

  function applyPhoneFilterFromStorage() {
    try {
      var digits = localStorage.getItem(PAYMENTS_FILTER_PHONE_KEY);
      if (digits) {
        paymentsRuntime.filters.q = digits;
        localStorage.removeItem(PAYMENTS_FILTER_PHONE_KEY);
      }
    } catch {}
  }

  function showPendingNewBanner(count) {
    var root = document.getElementById("admin-payments-main");
    if (!root) return;
    var existing = root.querySelector("[data-payments-new-banner]");
    if (existing) existing.remove();
    if (!count) return;
    var el = document.createElement("div");
    el.className = "admin-payments-new-banner";
    el.setAttribute("data-payments-new-banner", "1");
    el.innerHTML =
      '<span class="admin-payments-new-banner__text">+' +
      String(count) +
      " новых заявок на подтверждение</span>" +
      '<button type="button" class="btn btn--secondary btn--sm" data-payments-show-new>Показать</button>';
    root.insertBefore(el, root.firstChild);
    el.querySelector("[data-payments-show-new]").addEventListener("click", function () {
      paymentsRuntime.pendingNewCount = 0;
      el.remove();
      setPaymentsTab("pending", root);
      mergePendingFromPoll(paymentsRuntime.cache.payments, paymentsRuntime.token, true);
    });
  }

  function mergePendingFromPoll(payments, token, forceInsert) {
    var section = document.querySelector('[data-payments-section="pending"]');
    if (!section) return;
    var fresh = [];
    var ids = new Set();
    (Array.isArray(payments) ? payments : []).forEach(function (p) {
      ids.add(String(p.id));
      var card = section.querySelector('.admin-payment-card[data-order-id="' + String(p.id) + '"]');
      if (!card) fresh.push(p);
    });
    section.querySelectorAll(".admin-payment-card").forEach(function (card) {
      var oid = card.getAttribute("data-order-id");
      if (oid && !ids.has(oid)) card.remove();
    });
    if (fresh.length && (forceInsert || !paymentsRuntime.filters.q)) {
      var html = fresh.map(renderPaymentCard).join("");
      section.insertAdjacentHTML("afterbegin", html);
      bindPaymentsCardHandlers(section, token);
      fresh.forEach(function (p) {
        var c = section.querySelector('.admin-payment-card[data-order-id="' + String(p.id) + '"]');
        if (c) {
          c.classList.add("admin-payment-card--new");
          setTimeout(function () {
            c.classList.remove("admin-payment-card--new");
          }, 8000);
        }
      });
    }
    var mainEl = document.getElementById("admin-payments-main");
    if (mainEl) updatePaymentTabBadges(mainEl);
  }

  function pollPaymentsQueue() {
    var s = loadSession();
    if (!s || !s.token || paymentsRuntime.loading) return;
    if (countPendingInCache() > 0) return;
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
        if (!x.ok) return;
        var prevPending = paymentsRuntime.cache && paymentsRuntime.cache.payments ? paymentsRuntime.cache.payments : [];
        var prevIds = new Set(prevPending.map(function (p) { return String(p.id); }));
        var payments = x.data.payments || [];
        var newOnes = payments.filter(function (p) {
          return !prevIds.has(String(p.id));
        });
        paymentsRuntime.cache = {
          payments: payments,
          active: x.data.active_orders || [],
          history: filterHistoryRows(x.data.history || []),
          historyHasMore: !!x.data.history_has_more,
          historyNextOffset: Number(x.data.history_next_offset ?? 0),
          historyTotal: Number(x.data.history_total ?? 0),
          serverTimeMs: x.data.server_time_ms,
          receiptRejectMax: Number(x.data.receipt_reject_max) || paymentsRuntime.receiptRejectMax,
        };
        paymentsRuntime.lastFetchAt = Date.now();
        paymentsRuntime.receiptRejectMax = paymentsRuntime.cache.receiptRejectMax;
        if (newOnes.length) {
          paymentsRuntime.pendingNewCount += newOnes.length;
          showPendingNewBanner(paymentsRuntime.pendingNewCount);
          var panel = document.querySelector('[data-payments-panel="pending"]');
          if (panel && !panel.hidden && !paymentsRuntime.filters.q) {
            mergePendingFromPoll(payments, s.token, true);
            paymentsRuntime.pendingNewCount = 0;
            var banner = document.querySelector("[data-payments-new-banner]");
            if (banner) banner.remove();
          }
        }
        var nRes = (paymentsRuntime.cache.active || []).length;
        var nPen = payments.length;
        var elR = document.querySelector('[data-payments-count="reserved"]');
        var elP = document.querySelector('[data-payments-count="pending"]');
        if (elR) elR.textContent = String(nRes);
        if (elP) elP.textContent = String(nPen);
        initReservedUntilCountdown(paymentsRuntime.cache.serverTimeMs);
      })
      .catch(function () {});
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
          '<button type="button" class="admin-payment-rhist__link admin-payment-rhist__link--btn" data-preview-receipt="' +
          url +
          '" data-receipt-mime="">' +
          ICO.receipt +
          '<span class="admin-payment-rhist__fname">' +
          name +
          "</span></button></li>"
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

  function bindCopyHandlers(container) {
    container.querySelectorAll("[data-copy-value], [data-copy-phone]").forEach(function (btn) {
      if (btn.getAttribute("data-copy-bound") === "1") return;
      btn.setAttribute("data-copy-bound", "1");
      btn.addEventListener("click", function () {
        var value = btn.getAttribute("data-copy-value") || btn.getAttribute("data-copy-phone") || "";
        if (!value) return;
        copyTextToClipboard(value, function () {
          btn.classList.add("admin-payment-inline-copy--copied", "admin-payment-phone-copy--copied");
          var prev = copyResetTimers.get(btn);
          if (prev) clearTimeout(prev);
          var t = setTimeout(function () {
            btn.classList.remove("admin-payment-inline-copy--copied", "admin-payment-phone-copy--copied");
            copyResetTimers.delete(btn);
          }, COPY_DONE_MS);
          copyResetTimers.set(btn, t);
        });
      });
    });
  }

  function bindPaymentsCardHandlers(container, token) {
    container.querySelectorAll("[data-chat-user]").forEach(function (btn) {
      if (btn.getAttribute("data-bound-chat") === "1") return;
      btn.setAttribute("data-bound-chat", "1");
      btn.addEventListener("click", function () {
        var uid = Number(btn.getAttribute("data-chat-user"));
        if (!Number.isFinite(uid)) return;
        if (typeof window.abAdminOpenSupportChat === "function") window.abAdminOpenSupportChat(uid);
      });
    });
    container.querySelectorAll("[data-confirm-order]").forEach(function (btn) {
      if (btn.getAttribute("data-bound-action") === "1") return;
      btn.setAttribute("data-bound-action", "1");
      btn.addEventListener("click", function () {
        openConfirmModal(token, Number(btn.getAttribute("data-confirm-order")));
      });
    });
    container.querySelectorAll("[data-reject-order]").forEach(function (btn) {
      if (btn.getAttribute("data-bound-action") === "1") return;
      btn.setAttribute("data-bound-action", "1");
      btn.addEventListener("click", function () {
        openRejectModal(token, Number(btn.getAttribute("data-reject-order")));
      });
    });
    container.querySelectorAll("[data-release-order]").forEach(function (btn) {
      if (btn.getAttribute("data-bound-action") === "1") return;
      btn.setAttribute("data-bound-action", "1");
      btn.addEventListener("click", function () {
        openReleaseModal(token, Number(btn.getAttribute("data-release-order")));
      });
    });
    container.querySelectorAll("[data-preview-receipt]").forEach(function (btn) {
      if (btn.getAttribute("data-bound-preview") === "1") return;
      btn.setAttribute("data-bound-preview", "1");
      btn.addEventListener("click", function () {
        openReceiptLightbox(btn.getAttribute("data-preview-receipt"), btn.getAttribute("data-receipt-mime"));
      });
    });
    container.querySelectorAll("[data-tickets-toggle]").forEach(function (btn) {
      if (btn.getAttribute("data-bound-tickets") === "1") return;
      btn.setAttribute("data-bound-tickets", "1");
      btn.addEventListener("click", function () {
        var wrap = btn.closest(".admin-payment-tickets");
        if (!wrap) return;
        var full = wrap.querySelector(".admin-payment-tickets__full");
        var preview = wrap.querySelector(".admin-payment-tickets__preview");
        if (!full) return;
        var open = full.hidden;
        full.hidden = !open;
        if (preview) preview.hidden = open;
        btn.textContent = open ? "Скрыть" : btn.getAttribute("data-label-show") || "Показать все";
      });
    });
    container.querySelectorAll("[data-payments-filter-phone]").forEach(function (btn) {
      if (btn.getAttribute("data-bound-filter") === "1") return;
      btn.setAttribute("data-bound-filter", "1");
      btn.addEventListener("click", function () {
        paymentsRuntime.filters.q = btn.getAttribute("data-payments-filter-phone") || "";
        var input = document.querySelector("[data-payments-search]");
        if (input) input.value = paymentsRuntime.filters.q;
        rerenderPendingSection();
        rerenderReservedSection();
        setPaymentsTab("pending", document.getElementById("admin-payments-main") || document.body);
      });
    });
    bindCopyHandlers(container);
  }

  function removeOrderCardFromView(orderId) {
    var id = Number(orderId);
    if (!Number.isFinite(id)) return;
    var card = document.querySelector('.admin-payment-card[data-order-id="' + String(id) + '"]');
    if (!card) return;
    var section = card.closest("[data-payments-section]");
    var kind = section && section.getAttribute("data-payments-section");
    if (kind === "pending") removeOrderFromPaymentsCache(id);
    else if (kind === "reserved") removeOrderFromActiveCache(id);
    card.remove();
    updatePaymentsCountBadges();
    syncPaymentsPoll();
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
            bindPaymentsCardHandlers(section, token);
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

  function collectRaffleFilterOptions(cache) {
    var map = new Map();
    function addRows(rows) {
      (Array.isArray(rows) ? rows : []).forEach(function (p) {
        if (p.raffle_id == null) return;
        map.set(String(p.raffle_id), String(p.raffle_title || "Акция " + String(p.raffle_id)));
      });
    }
    if (cache) {
      addRows(cache.payments);
      addRows(cache.active);
    }
    return Array.from(map.entries()).sort(function (a, b) {
      return a[1].localeCompare(b[1], "ru");
    });
  }

  function renderPaymentsToolbar(cache) {
    var raffles = collectRaffleFilterOptions(cache);
    var raffleOpts =
      '<option value="">Все акции</option>' +
      raffles
        .map(function (pair) {
          var sel = paymentsRuntime.filters.raffle === pair[0] ? " selected" : "";
          return '<option value="' + esc(pair[0]) + '"' + sel + ">" + esc(pair[1]) + "</option>";
        })
        .join("");
    var sort = paymentsRuntime.filters.sort || "queue_asc";
    return (
      '<div class="admin-payments-toolbar-row">' +
      '<button type="button" class="btn btn--secondary" data-admin-payments-reload>Обновить</button>' +
      '<span class="admin-payments-toolbar-row__ago" data-payments-updated-ago>загрузка…</span>' +
      "</div>" +
      '<div class="admin-payments-filters">' +
      '<label class="admin-payments-filters__field"><span class="visually-hidden">Поиск</span>' +
      '<input type="search" class="input admin-payments-filters__search" data-payments-search placeholder="Поиск: имя, телефон, A123, сумма…" value="' +
      esc(paymentsRuntime.filters.q) +
      '"></label>' +
      '<label class="admin-payments-filters__field"><span class="visually-hidden">Сортировка</span>' +
      '<select class="input admin-payments-filters__sort" data-payments-sort>' +
      '<option value="queue_asc"' +
      (sort === "queue_asc" ? " selected" : "") +
      ">Сначала старые в очереди</option>" +
      '<option value="receipt_desc"' +
      (sort === "receipt_desc" ? " selected" : "") +
      ">Чек: новые сверху</option>" +
      '<option value="receipt_asc"' +
      (sort === "receipt_asc" ? " selected" : "") +
      ">Чек: старые сверху</option>" +
      '<option value="amount_desc"' +
      (sort === "amount_desc" ? " selected" : "") +
      ">Сумма ↓</option>" +
      '<option value="amount_asc"' +
      (sort === "amount_asc" ? " selected" : "") +
      ">Сумма ↑</option>" +
      '<option value="raffle"' +
      (sort === "raffle" ? " selected" : "") +
      ">По акции</option>" +
      "</select></label>" +
      '<label class="admin-payments-filters__field"><span class="visually-hidden">Акция</span>' +
      '<select class="input admin-payments-filters__raffle" data-payments-raffle>' +
      raffleOpts +
      "</select></label>" +
      "</div>"
    );
  }

  function bindPaymentsToolbar(root) {
    if (!root) return;
    root.querySelectorAll("[data-admin-payments-reload]").forEach(function (btn) {
      if (btn.getAttribute("data-reload-bound") === "1") return;
      btn.setAttribute("data-reload-bound", "1");
      btn.addEventListener("click", function () {
        loadList(true);
      });
    });
    var search = root.querySelector("[data-payments-search]");
    if (search && search.getAttribute("data-search-bound") !== "1") {
      search.setAttribute("data-search-bound", "1");
      var debounce = null;
      search.addEventListener("input", function () {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(function () {
          paymentsRuntime.filters.q = String(search.value || "").trim();
          rerenderPendingSection();
          rerenderReservedSection();
        }, 280);
      });
    }
    var sortEl = root.querySelector("[data-payments-sort]");
    if (sortEl && sortEl.getAttribute("data-sort-bound") !== "1") {
      sortEl.setAttribute("data-sort-bound", "1");
      sortEl.addEventListener("change", function () {
        paymentsRuntime.filters.sort = sortEl.value || "queue_asc";
        rerenderPendingSection();
        rerenderReservedSection();
      });
    }
    var raffleEl = root.querySelector("[data-payments-raffle]");
    if (raffleEl && raffleEl.getAttribute("data-raffle-bound") !== "1") {
      raffleEl.setAttribute("data-raffle-bound", "1");
      raffleEl.addEventListener("change", function () {
        paymentsRuntime.filters.raffle = raffleEl.value || "";
        rerenderPendingSection();
      });
    }
  }

  function loadList(forceFull) {
    const listEl = document.getElementById("admin-payments-list");
    const tabsSlot = document.getElementById("admin-payments-tabs-slot");
    const mainEl = document.getElementById("admin-payments-main");
    if (!listEl) return;
    unbindHistoryInfiniteScroll();
    applyPhoneFilterFromStorage();
    initReceiptLightboxOnce();
    const s = loadSession();
    if (!s || !s.token) {
      if (tabsSlot) tabsSlot.innerHTML = "";
      listEl.innerHTML =
        '<div class="admin-payments-empty admin-payments-empty--soft"><p>Нет сессии</p></div>';
      return;
    }
    paymentsRuntime.token = s.token;
    paymentsRuntime.loading = true;
    if (tabsSlot) tabsSlot.innerHTML = "";
    listEl.innerHTML =
      '<div class="admin-payments-skeleton" aria-busy="true">' +
      '<div class="admin-payments-skeleton__card"></div>' +
      '<div class="admin-payments-skeleton__card"></div>' +
      '<div class="admin-payments-skeleton__card"></div>' +
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
          paymentsRuntime.cache = { payments: [], active: [], history: [], historyHasMore: false, historyNextOffset: 0, historyTotal: 0 };
          syncPaymentsPoll();
          return;
        }

        var nRes = active.length;
        var nPen = payments.length;
        var historyTotalRaw = Number(x.data.history_total);
        var nHist = Number.isFinite(historyTotalRaw) && historyTotalRaw >= 0 ? Math.floor(historyTotalRaw) : history.length;
        paymentsRuntime.cache = {
          payments: payments,
          active: active,
          history: history,
          historyHasMore: historyHasMore,
          historyNextOffset: historyNextOffset,
          historyTotal: nHist,
          serverTimeMs: serverTimeMs,
          receiptRejectMax: Number(x.data.receipt_reject_max) || 3,
        };
        paymentsRuntime.receiptRejectMax = paymentsRuntime.cache.receiptRejectMax;
        paymentsRuntime.lastFetchAt = Date.now();
        paymentsRuntime.pendingNewCount = 0;
        paymentsRuntime.knownPendingIds = new Set(payments.map(function (p) { return String(p.id); }));

        var initialTab = nPen > 0 ? "pending" : nRes > 0 ? "reserved" : "history";
        if (initialTab === "history" && nHist === 0 && nRes > 0) initialTab = "reserved";
        var tabsHtml = renderPaymentsToolbar(paymentsRuntime.cache);
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
        var filteredReserved = getFilteredReserved();
        var filteredPending = getFilteredPending();
        if (filteredReserved.length) {
          panelsHtml += filteredReserved.map(renderActiveCard).join("");
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
        if (filteredPending.length) {
          panelsHtml += filteredPending.map(renderPaymentCard).join("");
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
        bindPaymentsToolbar(rootForTabs);
        bindPaymentsCardHandlers(listEl, s.token);
        bindHistoryClearActions(rootForTabs);
        bindHistoryInfiniteScroll({
          root: rootForTabs,
          token: s.token,
          hasMore: historyHasMore,
          nextOffset: historyNextOffset,
        });
        initReservedUntilCountdown(serverTimeMs);
        startUpdatedAgoTimer();
        setInterval(paintWaitBadges, 30000);
        paintWaitBadges();
        paymentsRuntime.loading = false;
        syncPaymentsPoll();
      })
      .catch(function (e) {
        paymentsRuntime.loading = false;
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
      rejectMetaFacts(p) +
      "</ul>" +
      '<div class="admin-payment-card__actions admin-payment-card__actions--hierarchy">' +
      chatBtn +
      '<button type="button" class="admin-payment-btn admin-payment-btn--release admin-payment-btn--secondary" data-release-order="' +
      id +
      '">' +
      ICO.unlock +
      "<span>Снять бронь полностью</span></button>" +
      "</div></div></article>"
    );
  }

  function rejectMetaFacts(p) {
    var n = Number(p.receipt_reject_count || 0);
    var max = Number(paymentsRuntime.receiptRejectMax) || 3;
    var note = p.last_reject_comment != null ? String(p.last_reject_comment).trim() : "";
    if (!n && !note) return "";
    var lines = "";
    if (n > 0) {
      var attempt = Math.min(n + 1, max);
      lines +=
        '<li class="admin-payment-card__fact admin-payment-card__fact--warn">' +
        '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--amber">' +
        ICO.x +
        "</span>" +
        "<span><strong>Попытка</strong> · " +
        esc(String(attempt)) +
        " из " +
        esc(String(max)) +
        (n >= max ? " (лимит)" : "") +
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
    const bankLabel = p.bank === "sber" ? "Сбербанк" : p.bank === "other" ? "Другой банк" : "—";
    const id = String(p.id);
    const publicId = "A" + id;
    var uid = p.user_id != null ? Number(p.user_id) : NaN;
    var chatBtn =
      Number.isFinite(uid) && uid > 0
        ? '<button type="button" class="admin-payment-btn admin-payment-btn--chat admin-payment-btn--secondary" data-chat-user="' +
          String(uid) +
          '">' +
          ICO.chat +
          "<span>Написать в чат</span></button>"
        : "";
    var waitSince = Number(p.updated_at || p.created_at);
    return (
      '<article class="admin-payment-card" data-order-id="' +
      id +
      '">' +
      '<div class="admin-payment-card__stripe" aria-hidden="true"></div>' +
      '<div class="admin-payment-card__body">' +
      renderDuplicateReceiptBanner(p) +
      '<header class="admin-payment-card__header">' +
      '<div class="admin-payment-card__raffle">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--violet">' +
      ICO.raffle +
      "</span>" +
      '<div class="admin-payment-card__raffle-text">' +
      '<span class="admin-payment-card__eyebrow">На проверке · ' +
      esc(publicId) +
      " " +
      renderCopyBtn(publicId, "Скопировать ID заявки") +
      " " +
      waitBadgeHtml(waitSince) +
      "</span>" +
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
      ' <span class="admin-payment-card__currency">₽</span> ' +
      renderCopyBtn(String(p.amount_rub ?? 0), "Скопировать сумму") +
      "</p></div></div></header>" +
      '<ul class="admin-payment-card__facts">' +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--teal">' +
      ICO.time +
      "</span>" +
      "<span><strong>Создано</strong> · " +
      esc(formatOrderCreatedLocal(p.created_at)) +
      ' <span class="admin-payment-card__tz-hint">(ваш часовой пояс)</span></span></li>' +
      renderUserPhoneFact(p, { showCopy: true }) +
      renderTicketsFact(p) +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--slate">' +
      ICO.bank +
      "</span><span>" +
      esc(bankLabel) +
      "</span></li>" +
      '<li class="admin-payment-card__fact admin-payment-card__fact--receipt">' +
      renderReceiptControl(p) +
      "</li>" +
      rejectMetaFacts(p) +
      "</ul>" +
      renderPendingReceiptHistory(p) +
      '<div class="admin-payment-card__actions admin-payment-card__actions--hierarchy">' +
      '<div class="admin-payment-card__actions-primary">' +
      '<button type="button" class="admin-payment-btn admin-payment-btn--confirm" data-confirm-order="' +
      id +
      '">' +
      ICO.check +
      "<span>Подтвердить</span></button>" +
      "</div>" +
      '<div class="admin-payment-card__actions-secondary">' +
      chatBtn +
      '<button type="button" class="admin-payment-btn admin-payment-btn--reject admin-payment-btn--secondary" data-reject-order="' +
      id +
      '">' +
      ICO.x +
      "<span>Отклонить чек</span></button>" +
      '<button type="button" class="admin-payment-btn admin-payment-btn--release admin-payment-btn--secondary" data-release-order="' +
      id +
      '">' +
      ICO.unlock +
      "<span>Снять бронь</span></button>" +
      "</div></div></div></article>"
    );
  }  function paymentStatusLabel(status) {
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
          '<button type="button" class="admin-payment-rhist__link admin-payment-rhist__link--btn" data-preview-receipt="' +
          url +
          '" data-receipt-mime="">' +
          ICO.receipt +
          '<span class="admin-payment-rhist__fname">' +
          name +
          "</span></button></li>"
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
      renderUserPhoneFact(p, { showCopy: true }) +
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

  async function submitConfirm(token, orderId) {
    setCardBusy(orderId, true);
    try {
      const res = await fetch("/api/admin/raffle-payments/" + String(orderId) + "/confirm", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "Ошибка");
      removeOrderCardFromView(orderId);
      showToast("Оплата подтверждена", "ok");
    } catch (e) {
      showToast(String(e.message || "Ошибка"), "err");
    } finally {
      setCardBusy(orderId, false);
    }
  }

  async function submitReject(token, orderId, comment) {
    setCardBusy(orderId, true);
    try {
      const res = await fetch("/api/admin/raffle-payments/" + String(orderId) + "/reject", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ comment: String(comment || "").trim() }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "Ошибка");
      if (data.mode === "fully_released") {
        showToast("Лимит доработок исчерпан — заявка отменена", "warn");
      } else {
        showToast("Чек отклонён, заявка возвращена в бронь", "ok");
      }
      removeOrderCardFromView(orderId);
    } catch (e) {
      showToast(String(e.message || "Ошибка"), "err");
    } finally {
      setCardBusy(orderId, false);
    }
  }

  async function submitRelease(token, orderId, comment) {
    setCardBusy(orderId, true);
    try {
      const res = await fetch("/api/admin/raffle-orders/" + String(orderId) + "/release", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ comment: String(comment || "").trim() }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "Ошибка");
      removeOrderCardFromView(orderId);
      showToast("Бронь снята", "ok");
    } catch (e) {
      showToast(String(e.message || "Ошибка"), "err");
    } finally {
      setCardBusy(orderId, false);
    }
  }

  window.abInitPayments = function () {
    if (window.__abPaymentsInited) {
      loadList(true);
      return;
    }
    window.__abPaymentsInited = true;
    loadList(true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closePaymentsModal();
        closeReceiptLightbox();
      }
    });
  };
})();
