(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";
  const TOKEN_COOKIE = "ab_tok";
  const AUTH_COOKIE_MAX_AGE = 31536000;

  function cookieDomainAttr() {
    var h = location.hostname || "";
    if (h === "andreybolotov.ru" || /\.andreybolotov\.ru$/.test(h)) {
      return "; Domain=.andreybolotov.ru";
    }
    return "";
  }

  function writeAuthCookie(_token) {
    // Beeline CDN 403 when Cookie present — do not set auth cookies
    var dom = cookieDomainAttr();
    document.cookie = STORAGE_KEY + "=; path=/; max-age=0" + dom;
    document.cookie = STORAGE_KEY + "=; path=/; max-age=0";
    document.cookie = TOKEN_COOKIE + "=; path=/; max-age=0" + dom;
    document.cookie = TOKEN_COOKIE + "=; path=/; max-age=0";
    document.cookie = "ab_sess=; path=/; max-age=0" + dom;
    document.cookie = "ab_sess=; path=/; max-age=0";
  }

  function loadSession() {
    try {
      writeAuthCookie("");
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (j && j.token && j.phone) return j;
      if (j && j.token) return j;
      return null;
    } catch {
      return null;
    }
  }

  /** @type {Array<{id:number;phone:string;name:string;locality?:string;role:string;last_body:string|null;last_at:number|null;last_is_staff:number|null;unread_count:number}>} */
  let allUsersCache = [];
  /** Строка поиска в сайдбаре «Диалоги» (телефон / текст); синхронизируется с полем с debounce */
  let supportThreadSearch = "";
  /** @type {'all' | 'new' | 'unanswered'} */
  let adminTab = "all";
  /** @type {string[]} */
  let adminStaffAreas = [];
  let adminSessionRole = "user";

  let userTypingInThreadActive = false;
  /** @type {number | null} */
  let userTypingDotsTimer = null;
  /** @type {number | null} */
  let adminTypingDebounceTimer = null;
  /** @type {number | null} */
  let adminTypingIdleTimer = null;
  /** @type {number | null} */
  let userTypingPollTimer = null;

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

  function formatRuPhone(phone) {
    const d = String(phone).replace(/\D/g, "");
    if (d.length !== 11) return phone;
    return (
      "+7 (" +
      d.slice(1, 4) +
      ") " +
      d.slice(4, 7) +
      "-" +
      d.slice(7, 9) +
      "-" +
      d.slice(9, 11)
    );
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return (
      String(d.getDate()).padStart(2, "0") +
      "." +
      String(d.getMonth() + 1).padStart(2, "0") +
      " " +
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  function formatDateTime(ts) {
    const d = new Date(Number(ts));
    return (
      String(d.getDate()).padStart(2, "0") +
      "." +
      String(d.getMonth() + 1).padStart(2, "0") +
      "." +
      String(d.getFullYear()) +
      " " +
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  function formatLastActive(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "не был в сети";
    const diffMs = Date.now() - n;
    if (!Number.isFinite(diffMs) || diffMs < 0) return formatDateTime(n);
    const min = Math.floor(diffMs / 60000);
    if (min <= 1) return "только что";
    if (min < 60) return min + " мин назад";
    const h = Math.floor(min / 60);
    if (h < 24) return h + " ч назад";
    const d = new Date(n);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (isToday) {
      return (
        "сегодня в " +
        String(d.getHours()).padStart(2, "0") +
        ":" +
        String(d.getMinutes()).padStart(2, "0")
      );
    }
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const isYesterday =
      d.getFullYear() === y.getFullYear() &&
      d.getMonth() === y.getMonth() &&
      d.getDate() === y.getDate();
    if (isYesterday) {
      return (
        "вчера в " +
        String(d.getHours()).padStart(2, "0") +
        ":" +
        String(d.getMinutes()).padStart(2, "0")
      );
    }
    return formatDateTime(n);
  }

  function buildThreadMeta(user) {
        const locality = user && user.locality ? String(user.locality) : "Не указано";
    return (
      formatRuPhone(user.phone) +
      " · " +
      locality +
      " · Последний актив: " +
      formatLastActive(user.last_active_at)
    );
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function attachmentHtml(m) {
    if (!m.attachment_url) return "";
    var url = String(m.attachment_url).replace(/"/g, "&quot;");
    var name = esc(m.attachment_name || "файл");
    var mime = String(m.attachment_mime || "");
    if (/^image\//i.test(mime)) {
      return (
        '<div class="admin-msg-attachment admin-msg-attachment--img"><a href="' +
        url +
        '" target="_blank" rel="noopener noreferrer"><img src="' +
        url +
        '" alt="" loading="lazy"/></a></div>'
      );
    }
    return (
      '<div class="admin-msg-attachment"><a href="' +
      url +
      '" target="_blank" rel="noopener noreferrer" download>📎 ' +
      name +
      "</a></div>"
    );
  }

  function formatAdminBodyWithMaxJoinLineAsButton(escapedBody) {
    var raw = String(escapedBody || "");
    if (!raw) return "";
    var lines = raw.split(/\n/g);
    var out = [];
    var maxJoinRe = /^https:\/\/max\.ru\/join\/[A-Za-z0-9_-]+$/;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (maxJoinRe.test(line)) {
        var href = line.replace(/"/g, "&quot;");
        out.push(
          '<a class="chat-max-join-btn" href="' +
            href +
            '" target="_blank" rel="noopener noreferrer">Присоединиться к чату в MAX</a>',
        );
      } else if (line) {
        out.push(line);
      } else {
        out.push("");
      }
    }
    return out.join("<br/>");
  }

  function parseAdminActionCards(rawBody) {
    var body = String(rawBody || "");
    var cards = [];
    var re = /\[\[AB_CARD:([^\]]+)\]\]/g;
    var m;
    while ((m = re.exec(body)) !== null) {
      try {
        var parsed = JSON.parse(decodeURIComponent(String(m[1] || "").trim()));
        if (parsed && typeof parsed === "object") cards.push(parsed);
      } catch (_) {}
    }
    var text = body.replace(/\n?\[\[AB_CARD:[^\]]+\]\]/g, "").trim();
    return { text: text, cards: cards };
  }

  var CHAT_ICO_GIFT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"></rect><path d="M12 8V21"></path><path d="M3 12h18"></path><path d="M7.5 8a2.5 2.5 0 0 1 0-5C9 3 12 8 12 8s3-5 4.5-5a2.5 2.5 0 0 1 0 5H7.5z"></path></svg>';
  var CHAT_ICO_EXTERNAL =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
  var CHAT_ICO_PARTY =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 11.3 2 22l10.7-3.8"></path><path d="M4 3h.01"></path><path d="M22 8h.01"></path><path d="M15 2h.01"></path><path d="M22 20h.01"></path><path d="m22 2-2 2.5"></path><path d="M9 9 13 5 22 14l-4 4-9-9Z"></path></svg>';
  var CHAT_ICO_MESSAGE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

  function adminBonusTableCardHtml(card) {
    var headline =
      String(card.headline || card.title || "").trim() ||
      (card.variant === "manual" ? "Вас добавили в список" : "Вы попали в бонусную таблицу!");
    var eyebrow = esc(String(card.eyebrow || "Бонусная таблица"));
    var subtitle = card.subtitle ? '<p class="chat-action-card__subtitle">' + esc(String(card.subtitle)) + "</p>" : "";
    var message = card.message || card.reason;
    var messageHtml = message ? '<p class="chat-action-card__reason">' + esc(String(message)) + "</p>" : "";
    var chips = "";
    if (Array.isArray(card.positions) && card.positions.length) {
      chips =
        '<div class="chat-action-card__chips">' +
        card.positions
          .map(function (p) {
            return (
              '<span class="chat-action-card__chip chat-action-card__chip--bonus">#' +
              esc(String(p)) +
              "</span>"
            );
          })
          .join("") +
        "</div>";
    }
    var openHref = String(card.open_url || "").trim();
    var openCta = esc(String(card.cta || "Открыть бонусную таблицу"));
    var openAction = openHref
      ? '<a class="chat-action-card__btn chat-action-card__btn--bonus-table" href="' +
        openHref.replace(/"/g, "&quot;") +
        '" target="_blank" rel="noopener noreferrer">' +
        CHAT_ICO_EXTERNAL +
        "<span>" +
        openCta +
        "</span></a>"
      : '<span class="chat-action-card__btn chat-action-card__btn--bonus-table">' + openCta + "</span>";
    return (
      '<div class="chat-action-card chat-action-card--bonus-table">' +
      '<div class="chat-action-card__head">' +
      '<span class="chat-action-card__icon chat-action-card__icon--bonus" aria-hidden="true">' +
      CHAT_ICO_GIFT +
      "</span>" +
      '<div class="chat-action-card__head-text">' +
      '<p class="chat-action-card__eyebrow">' +
      eyebrow +
      "</p>" +
      '<p class="chat-action-card__title">' +
      esc(headline) +
      "</p></div></div>" +
      subtitle +
      messageHtml +
      chips +
      openAction +
      "</div>"
    );
  }

  function adminReceiptConfirmedCardHtml(card) {
    var eyebrow = esc(String(card.eyebrow || "Оплата подтверждена"));
    var headline = esc(String(card.headline || "Поздравляем!"));
    var subtitle = card.subtitle
      ? '<p class="chat-action-card__subtitle">Акция «' + esc(String(card.subtitle)) + "»</p>"
      : "";
    var message = card.message ? '<p class="chat-action-card__reason">' + esc(String(card.message)) + "</p>" : "";
    var paidHtml = "";
    if (Array.isArray(card.paid_tickets) && card.paid_tickets.length) {
      paidHtml =
        '<div class="chat-action-card__detail-row"><div class="chat-action-card__detail-body">' +
        '<span class="chat-action-card__detail-label">Оплаченные номерки</span>' +
        '<div class="chat-action-card__chips">' +
        card.paid_tickets
          .map(function (n) {
            return '<span class="chat-action-card__chip chat-action-card__chip--ticket">№' + esc(String(n)) + "</span>";
          })
          .join("") +
        "</div></div></div>";
    }
    var bonusHtml = "";
    if (Array.isArray(card.bonus_tickets) && card.bonus_tickets.length) {
      var promo = card.bonus_promo ? " · акция " + esc(String(card.bonus_promo)) : "";
      bonusHtml =
        '<div class="chat-action-card__detail-row"><div class="chat-action-card__detail-body">' +
        '<span class="chat-action-card__detail-label">Бонусные номерки' +
        promo +
        "</span>" +
        '<div class="chat-action-card__chips">' +
        card.bonus_tickets
          .map(function (n) {
            return '<span class="chat-action-card__chip chat-action-card__chip--gift">№' + esc(String(n)) + "</span>";
          })
          .join("") +
        "</div></div></div>";
    }
    var maxUrl = String(card.max_join_url || "").trim();
    var maxBtn = maxUrl
      ? '<a class="chat-action-card__btn chat-action-card__btn--max" href="' +
        maxUrl.replace(/"/g, "&quot;") +
        '" target="_blank" rel="noopener noreferrer">' +
        CHAT_ICO_MESSAGE +
        "<span>" +
        esc(String(card.max_cta || "Присоединиться к чату в MAX")) +
        "</span></a>"
      : "";
    return (
      '<div class="chat-action-card chat-action-card--receipt-confirmed">' +
      '<div class="chat-action-card__head">' +
      '<span class="chat-action-card__icon chat-action-card__icon--success" aria-hidden="true">' +
      CHAT_ICO_PARTY +
      "</span>" +
      '<div class="chat-action-card__head-text">' +
      '<p class="chat-action-card__eyebrow">' +
      eyebrow +
      "</p>" +
      '<p class="chat-action-card__title">' +
      headline +
      "</p></div></div>" +
      subtitle +
      message +
      paidHtml +
      bonusHtml +
      maxBtn +
      "</div>"
    );
  }

  function adminActionCardHtml(card) {
    if (card && card.kind === "receipt_confirmed") {
      return adminReceiptConfirmedCardHtml(card);
    }
    if (card && card.kind === "prize_claim") {
      var subtitle = card.subtitle ? '<p class="chat-action-card__reason">' + esc(String(card.subtitle)) + "</p>" : "";
      var href = String(card.claim_url || "").trim();
      var cta = esc(String(card.cta || "Получить приз"));
      var action = href
        ? '<a class="chat-action-card__btn chat-action-card__btn--prize" href="' +
          href.replace(/"/g, "&quot;") +
          '" target="_blank" rel="noopener noreferrer">' +
          cta +
          "</a>"
        : '<span class="chat-action-card__btn chat-action-card__btn--prize">' + cta + "</span>";
      return (
        '<div class="chat-action-card chat-action-card--prize">' +
        '<p class="chat-action-card__title">' +
        esc(String(card.title || "Получить приз")) +
        "</p>" +
        subtitle +
        action +
        "</div>"
      );
    }
    if (card && card.kind === "bonus_table") {
      return adminBonusTableCardHtml(card);
    }
    if (!card || card.kind !== "receipt_rejected") return "";
    var reason = card.reason ? '<p class="chat-action-card__reason">' + esc(String(card.reason)) + "</p>" : "";
    var href = String(card.retry_url || "").trim();
    var cta = esc(String(card.cta || "Повторить оплату"));
    var action = href
      ? '<a class="chat-action-card__btn chat-action-card__btn--payment-retry" href="' +
        href.replace(/"/g, "&quot;") +
        '" target="_blank" rel="noopener noreferrer">' +
        cta +
        "</a>"
      : '<span class="chat-action-card__btn chat-action-card__btn--payment-retry">' + cta + "</span>";
    return (
      '<div class="chat-action-card chat-action-card--payment-retry">' +
      '<p class="chat-action-card__title">Оплата отклонена</p>' +
      reason +
      action +
      "</div>"
    );
  }

  function messageBubbleInnerHtml(m) {
    var att = attachmentHtml(m);
    var parsed = parseAdminActionCards(m.body);
    var body = String(parsed.text || "").trim();
    var text = body
      ? '<div class="admin-msg-bubble__body">' + formatAdminBodyWithMaxJoinLineAsButton(esc(body)) + "</div>"
      : "";
    var cardsHtml = (parsed.cards || []).map(adminActionCardHtml).join("");
    return att + text + cardsHtml;
  }

  const ADMIN_CHAT_IMAGE_SKIP_COMPRESS_BELOW_BYTES = 1.2 * 1024 * 1024;
  const ADMIN_CHAT_IMAGE_MAX_LONG_EDGE = 1920;
  const ADMIN_CHAT_IMAGE_JPEG_QUALITY = 0.82;

  function loadImageFromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        resolve(im);
      };
      im.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("IMAGE_DECODE"));
      };
      im.src = url;
    });
  }

  function prepareAdminChatUploadFile(file) {
    var type = String((file && file.type) || "")
      .toLowerCase()
      .split(";")[0]
      .trim();
    if (!type || type.indexOf("image/") !== 0) return Promise.resolve(file);
    if (file.size > 0 && file.size < ADMIN_CHAT_IMAGE_SKIP_COMPRESS_BELOW_BYTES) return Promise.resolve(file);
    return loadImageFromFile(file)
      .then(function (img) {
        var w = Number(img.naturalWidth || img.width || 0);
        var h = Number(img.naturalHeight || img.height || 0);
        if (!w || !h) return file;
        var scale = Math.min(1, ADMIN_CHAT_IMAGE_MAX_LONG_EDGE / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        if (!ctx) return file;
        ctx.drawImage(img, 0, 0, w, h);
        return new Promise(function (resolve) {
          try {
            canvas.toBlob(function (blob) {
              if (!blob || blob.size <= 0 || blob.size >= file.size * 0.97) {
                resolve(file);
                return;
              }
              var base = String(file.name || "chat-image").replace(/\.[^.\\/]+$/, "").trim() || "chat-image";
              resolve(new File([blob], base + ".jpg", { type: "image/jpeg", lastModified: Date.now() }));
            }, "image/jpeg", ADMIN_CHAT_IMAGE_JPEG_QUALITY);
          } catch (_) {
            resolve(file);
          }
        });
      })
      .catch(function () {
        return file;
      });
  }

  function messageDeleteButtonHtml(m) {
    if (!m || !m.is_staff) return "";
    var id = Number(m.id);
    if (!Number.isFinite(id) || id <= 0) return "";
    return (
      '<button type="button" class="admin-msg-delete-btn" data-admin-delete-msg="' +
      String(id) +
      '" aria-label="Удалить сообщение" title="Удалить сообщение">Удалить</button>'
    );
  }

  let gate = null;
  let adminLoading = null;
  let adminRoot = null;
  let app = null;
  let rafflesApp = null;
  let paymentsApp = null;
  let prizesApp = null;
  let usersApp = null;
  let settingsApp = null;
  let musicApp = null;
  let statsApp = null;
  let homeApp = null;
  let listEl = null;
  let empty = null;
  let thread = null;
  let threadName = null;
  let threadMeta = null;
  let messagesEl = null;
  let form = null;
  let input = null;
  let btnAdminSend = null;

  const CANNED_ADMIN_REPLIES = {
    where_order:
      "Здравствуйте! Номер заказа и актуальный этап (бронь, чек на проверке, подтверждение) можно посмотреть по персональной ссылке из SMS или письма — страница «Статус заказа». Там же отображается краткая история шагов.",
    how_receipt:
      "Чек нужно прикрепить на экране оплаты акции: после перевода откройте шаг с загрузкой файла (фото или PDF из банка) и отправьте на проверку. Убедитесь, что на чеке видны дата, сумма и получатель.",
    wait_time:
      "После отправки чека заявка попадает в очередь на проверку. Обычно это занимает до суток (точнее — как настроено на сайте). Если срок заметно вышел, напишите сюда с номером заказа — мы подскажем.",
  };

  let selectedId = null;
  /** @type {{ id: number; phone: string; name: string; locality?: string; role: string; last_active_at?: number | null } | null} */
  let selectedUserData = null;
  /** Пока грузится тред, не сбрасывать selectedId в loadUsers (иначе гонка с WS). */
  let threadLoadUserId = null;
  let threadLastActiveTimer = null;

  let modalEditUser = null;
  let modalUserTickets = null;
  let modalUserTicketsRaffle = null;
  let modalUserTicketsContent = null;
  let adminDidInit = false;

  function runWhenAdminDomReady(fn) {
    var tries = 0;
    var tick = function () {
      refreshDomRefs();
      if (adminLoading && adminRoot) {
        fn();
        return;
      }
      tries += 1;
      window.setTimeout(tick, tries < 20 ? 120 : 350);
    };
    tick();
  }

  function refreshDomRefs() {
    gate = document.getElementById("admin-gate");
    adminLoading = document.getElementById("admin-loading");
    adminRoot = document.getElementById("admin-root");
    app = document.getElementById("admin-app");
    rafflesApp = document.getElementById("admin-raffles-app");
    paymentsApp = document.getElementById("admin-payments-app");
    prizesApp = document.getElementById("admin-prizes-app");
    usersApp = document.getElementById("admin-users-app");
    settingsApp = document.getElementById("admin-settings-app");
    musicApp = document.getElementById("admin-music-app");
    statsApp = document.getElementById("admin-stats-app");
    homeApp = document.getElementById("admin-home-app");
    listEl = document.getElementById("admin-user-list");
    empty = document.getElementById("admin-empty");
    thread = document.getElementById("admin-thread");
    threadName = document.getElementById("admin-thread-name");
    threadMeta = document.getElementById("admin-thread-meta");
    messagesEl = document.getElementById("admin-messages");
    form = document.getElementById("admin-reply-form");
    input = document.getElementById("admin-reply-input");
    btnAdminSend = document.getElementById("btn-admin-reply-send");
    modalEditUser = document.getElementById("modal-edit-user");
    modalUserTickets = document.getElementById("modal-admin-user-tickets");
    modalUserTicketsRaffle = document.getElementById("admin-user-tickets-raffle");
    modalUserTicketsContent = document.getElementById("admin-user-tickets-content");
  }

  function waitForAdminDom(maxMs) {
    var timeout = Number(maxMs) > 0 ? Number(maxMs) : 4000;
    var startedAt = Date.now();
    return new Promise(function (resolve) {
      var check = function () {
        refreshDomRefs();
        if (adminLoading && adminRoot) return resolve(true);
        if (Date.now() - startedAt >= timeout) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    });
  }

  function closeUserTicketsModal() {
    if (!modalUserTickets) return;
    modalUserTickets.classList.remove("is-open");
    modalUserTickets.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function collectTicketNumbers(groups) {
    var out = [];
    var i;
    var j;
    for (i = 0; i < (groups || []).length; i++) {
      var nums = (groups[i] && groups[i].numbers) || [];
      for (j = 0; j < nums.length; j++) out.push(nums[j]);
    }
    return out;
  }

  function userTicketVariantForNumber(n, data) {
    var conf = collectTicketNumbers(data.confirmed || []);
    if (conf.indexOf(n) !== -1) return "ok";
    var pend = collectTicketNumbers(data.pending_review || []);
    if (pend.indexOf(n) !== -1) return "review";
    return "pending";
  }

  function renderUserTicketsModal(data) {
    if (!modalUserTicketsRaffle || !modalUserTicketsContent) return;
    var raffle = data && data.raffle;
    if (!raffle) {
      modalUserTicketsRaffle.textContent = "";
      modalUserTicketsContent.innerHTML =
        '<p class="admin-user-tickets__empty">В системе пока нет акций.</p>';
      return;
    }
    modalUserTicketsRaffle.textContent = "Акция: " + String(raffle.title);

    var wholesale = Array.isArray(data.wholesale_numbers) ? data.wholesale_numbers : [];
    var reserved = collectTicketNumbers(data.reserved || []);
    var pending = collectTicketNumbers(data.pending_review || []);
    var confirmed = collectTicketNumbers(data.confirmed || []);
    var uniq = new Set();
    var i;
    for (i = 0; i < reserved.length; i++) uniq.add(reserved[i]);
    for (i = 0; i < pending.length; i++) uniq.add(pending[i]);
    for (i = 0; i < confirmed.length; i++) uniq.add(confirmed[i]);
    var sortedNums = Array.from(uniq).sort(function (a, b) {
      return a - b;
    });

    var html = "";
    if (wholesale.length) {
      html +=
        '<p class="admin-user-tickets__wholesale">№ оптовика: ' +
        wholesale
          .map(function (w) {
            return "№ " + esc(String(w));
          })
          .join(", ") +
        "</p>";
    }
    if (sortedNums.length) {
      html += '<div class="admin-user-tickets__section"><div class="admin-user-tickets__chips">';
      for (i = 0; i < sortedNums.length; i++) {
        var n = sortedNums[i];
        var v = userTicketVariantForNumber(n, data);
        html +=
          '<span class="admin-user-tickets__chip admin-user-tickets__chip--' +
          (v === "ok" ? "ok" : v === "review" ? "review" : "pending") +
          '">№ ' +
          esc(String(n)) +
          "</span>";
      }
      html += "</div></div>";
    }

    if (!html) {
      html =
        '<p class="admin-user-tickets__empty">У пользователя нет номерков в этой акции.</p>';
    }
    modalUserTicketsContent.innerHTML = html;
  }

  function openUserTicketsModal() {
    if (!modalUserTickets || selectedId == null) return;
    modalUserTickets.classList.add("is-open");
    modalUserTickets.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (modalUserTicketsContent) {
      modalUserTicketsContent.innerHTML = '<p class="admin-user-tickets__empty">Загрузка…</p>';
    }
    if (modalUserTicketsRaffle) modalUserTicketsRaffle.textContent = "";
    apiJson("/api/admin/users/" + selectedId + "/latest-raffle-tickets", {
      headers: authHeaders(),
      cache: "no-store",
    })
      .then(function (data) {
        renderUserTicketsModal(data);
      })
      .catch(function (err) {
        if (modalUserTicketsContent) {
          modalUserTicketsContent.innerHTML =
            '<p class="admin-user-tickets__empty">' + esc(err.message || "Ошибка загрузки") + "</p>";
        }
        if (modalUserTicketsRaffle) modalUserTicketsRaffle.textContent = "";
      });
  }

  function showGate(msg) {
    refreshDomRefs();
    try {
      document.documentElement.classList.remove("admin-mobile-chat-active");
    } catch (_) {}
    if (adminLoading) adminLoading.hidden = true;
    if (gate) {
      gate.hidden = false;
      const p = gate.querySelector(".admin-gate__text");
      if (p && msg) p.textContent = msg;
    }
    if (adminRoot) adminRoot.hidden = true;
    if (app) app.hidden = true;
    if (rafflesApp) rafflesApp.hidden = true;
    if (paymentsApp) paymentsApp.hidden = true;
    if (prizesApp) prizesApp.hidden = true;
    if (usersApp) usersApp.hidden = true;
    if (settingsApp) settingsApp.hidden = true;
    if (musicApp) musicApp.hidden = true;
    if (statsApp) statsApp.hidden = true;
    if (homeApp) homeApp.hidden = true;
  }

  function tabToStaffArea(tab) {
    if (tab === "home") return "home";
    if (tab === "support") return "support";
    return tab;
  }

  /** Дублирует server/admin-roles.ts — fallback, если API не отдал staff_areas. */
  function staffAreasFromRole(role) {
    var r = String(role == null ? "" : role)
      .trim()
      .toLowerCase();
    if (r === "admin") r = "owner";
    if (!isStaffSession(r, true)) return [];
    if (r === "owner" || r === "developer" || r === "moderator") {
      return ["home", "support", "users", "raffles", "payments", "prizes", "settings", "music", "stats", "blog"];
    }
    if (r === "support") return ["home", "support", "payments", "raffles", "music"];
    if (r === "financier") return ["home", "support", "payments", "music"];
    return ["home"];
  }

  function resolveAdminStaffAreas(role, isStaff, fromApi) {
    var areas = Array.isArray(fromApi) ? fromApi.filter(Boolean) : [];
    if (!areas.length) areas = staffAreasFromRole(role);
    if (isStaffSession(role, isStaff) && areas.indexOf("home") < 0) areas.unshift("home");
    return areas;
  }

  function canAdminArea(area) {
    return adminStaffAreas.indexOf(area) >= 0;
  }

  function applyStaffNavVisibility() {
    var links = {
      home: "nav-link-home",
      support: "nav-link-support",
      users: "nav-link-users",
      raffles: "nav-link-raffles",
      payments: "nav-link-payments",
      prizes: "nav-link-prizes",
      settings: "nav-link-settings",
      music: "nav-link-music",
      stats: "nav-link-stats",
    };
    Object.keys(links).forEach(function (area) {
      var el = document.getElementById(links[area]);
      if (!el) return;
      var allowed = canAdminArea(area);
      el.hidden = !allowed;
      el.style.display = allowed ? "" : "none";
    });
  }

  function getAdminTab() {
    var tab = "home";
    try {
      var u = new URL(location.href);
      if (!u.searchParams.has("tab")) {
        tab = "home";
      } else {
        var t = String(u.searchParams.get("tab") || "")
          .trim()
          .toLowerCase();
        if (t === "home") tab = "home";
        else if (t === "support") tab = "support";
        else if (t === "raffles") tab = "raffles";
        else if (t === "payments") tab = "payments";
        else if (t === "prizes") tab = "prizes";
        else if (t === "users") tab = "users";
        else if (t === "settings") tab = "settings";
        else if (t === "music") tab = "music";
        else if (t === "stats") tab = "stats";
        else tab = "home";
      }
    } catch (_) {
      tab = "home";
    }
    if (!canAdminArea(tabToStaffArea(tab))) {
      if (canAdminArea("home")) return "home";
      return adminStaffAreas[0] || "home";
    }
    return tab;
  }

  function isAdminMobileChatLayout() {
    try {
      return window.matchMedia("(max-width: 699px)").matches;
    } catch (_) {
      return window.innerWidth <= 699;
    }
  }

  var adminMobileChatScrollLocked = false;
  var adminMobileChatScrollY = 0;

  function lockAdminPageScrollForMobileChat() {
    if (adminMobileChatScrollLocked) return;
    adminMobileChatScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.position = "fixed";
    document.body.style.top = "-" + adminMobileChatScrollY + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    adminMobileChatScrollLocked = true;
    window.scrollTo(0, 0);
  }

  function unlockAdminPageScrollForMobileChat() {
    if (!adminMobileChatScrollLocked) return;
    var restoreY = adminMobileChatScrollY || 0;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    adminMobileChatScrollLocked = false;
    adminMobileChatScrollY = 0;
    window.scrollTo(0, restoreY);
  }

  function syncAdminMobileChatShell() {
    try {
      var threadEl = document.getElementById("admin-thread");
      var supportVisible = getAdminTab() === "support" && app && !app.hidden;
      var threadOpen = !!(threadEl && !threadEl.hidden);
      var active = supportVisible && threadOpen && isAdminMobileChatLayout();
      document.documentElement.classList.toggle("admin-mobile-chat-active", active);
      if (active) {
        lockAdminPageScrollForMobileChat();
        window.scrollTo(0, 0);
        var page = document.querySelector(".admin-page");
        if (page && "scrollTop" in page) page.scrollTop = 0;
      } else {
        unlockAdminPageScrollForMobileChat();
      }
    } catch (_) {}
  }

  function applyAdminTab() {
    refreshDomRefs();
    var tab = getAdminTab();
    var heading = document.getElementById("admin-page-heading");
    var sub = document.getElementById("admin-page-sub");
    var navHome = document.getElementById("nav-link-home");
    var navSupport = document.getElementById("nav-link-support");
    var navUsers = document.getElementById("nav-link-users");
    var navRaffles = document.getElementById("nav-link-raffles");
    var navPayments = document.getElementById("nav-link-payments");
    var navPrizes = document.getElementById("nav-link-prizes");
    var navMusic = document.getElementById("nav-link-music");
    var navSettings = document.getElementById("nav-link-settings");
    var navStats = document.getElementById("nav-link-stats");

    if (homeApp) homeApp.hidden = tab !== "home";
    if (app) app.hidden = tab !== "support";
    if (rafflesApp) rafflesApp.hidden = tab !== "raffles";
    if (paymentsApp) paymentsApp.hidden = tab !== "payments";
    if (prizesApp) prizesApp.hidden = tab !== "prizes";
    if (usersApp) usersApp.hidden = tab !== "users";
    if (settingsApp) settingsApp.hidden = tab !== "settings";
    if (musicApp) musicApp.hidden = tab !== "music";
    if (statsApp) statsApp.hidden = tab !== "stats";

    applyStaffNavVisibility();

    if (heading) {
      heading.textContent =
        tab === "home"
          ? "Главная"
          : tab === "raffles"
          ? "Акции"
          : tab === "payments"
            ? "Оплаты акций"
            : tab === "prizes"
              ? "Призы"
              : tab === "users"
              ? "Пользователи"
              : tab === "settings"
                ? "Настройки"
                : tab === "music"
                  ? "Музыка"
                : tab === "stats"
                  ? "Статистика"
                : "Поддержка";
    }
    if (sub) {
      sub.textContent =
        tab === "home"
          ? "Выберите раздел в меню"
          : tab === "raffles"
          ? "Каталог акций на главной"
          : tab === "payments"
            ? "Проверка чеков и закрепление номерков"
            : tab === "prizes"
              ? "Выдача призов и ответы победителей"
              : tab === "users"
              ? "Все зарегистрированные пользователи"
                : tab === "settings"
                ? "Режим технических работ и параметры сайта"
                : tab === "music"
                  ? "Фоновая музыка и плейлист для пользователей"
                : tab === "stats"
                  ? "Аналитика по пользователям и акциям"
                : "Пользователи и переписка";
    }

    if (navHome) navHome.setAttribute("aria-current", tab === "home" ? "page" : "false");
    if (navSupport) navSupport.setAttribute("aria-current", tab === "support" ? "page" : "false");
    if (navUsers) navUsers.setAttribute("aria-current", tab === "users" ? "page" : "false");
    if (navRaffles) navRaffles.setAttribute("aria-current", tab === "raffles" ? "page" : "false");
    if (navPayments) navPayments.setAttribute("aria-current", tab === "payments" ? "page" : "false");
    if (navPrizes) navPrizes.setAttribute("aria-current", tab === "prizes" ? "page" : "false");
    if (navSettings) navSettings.setAttribute("aria-current", tab === "settings" ? "page" : "false");
    if (navMusic) navMusic.setAttribute("aria-current", tab === "music" ? "page" : "false");
    if (navStats) navStats.setAttribute("aria-current", tab === "stats" ? "page" : "false");

    if (tab === "raffles" && typeof window.abInitRaffles === "function") {
      window.abInitRaffles();
    }
    if (tab === "payments" && typeof window.abInitPayments === "function") {
      window.abInitPayments();
    }
    if (tab === "prizes" && typeof window.abInitPrizes === "function") {
      window.abInitPrizes();
    }
    if (tab === "users" && typeof window.abInitUsers === "function") {
      window.abInitUsers();
    }
    if (tab === "settings" && typeof window.abInitSettings === "function") {
      window.abInitSettings();
    }
    if (tab === "music" && typeof window.abInitMusic === "function") {
      window.abInitMusic();
    }
    if (tab === "stats" && typeof window.abInitStats === "function") {
      window.abInitStats();
    }
    if (tab === "home") {
      if (homeApp && homeApp.dataset.inited === "1" && typeof window.abReloadAdminHome === "function") {
        window.abReloadAdminHome();
      } else if (typeof window.abInitHome === "function") {
        window.abInitHome();
      }
    }
    syncAdminMobileChatShell();
  }

  function showApp() {
    refreshDomRefs();
    if (adminLoading) adminLoading.hidden = true;
    if (gate) gate.hidden = true;
    if (adminRoot) adminRoot.hidden = false;
    applyAdminTab();
  }

  /** Из оплат и др.: вкладка «Поддержка», открыть переписку с userId (даже без истории в списке). */
  window.abAdminOpenSupportChat = function (userId) {
    var id = Number(userId);
    if (!Number.isFinite(id)) return;
    if (getAdminTab() !== "support") {
      location.href = "/admin?tab=support&openUser=" + encodeURIComponent(String(id));
      return;
    }
    adminTab = "all";
    document.querySelectorAll(".admin-tab").forEach(function (b) {
      var on = b.getAttribute("data-tab") === "all";
      b.classList.toggle("admin-tab--active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    applyAdminTab();
    selectedId = id;
    if (empty) empty.hidden = true;
    if (thread) thread.hidden = false;
    syncAdminMobileChatShell();
    loadThread(id).catch(function (e) {
      alert(e.message || "Не удалось открыть чат");
    });
  };

  function processAdminOpenUserQuery() {
    try {
      var u = new URL(location.href);
      var raw = u.searchParams.get("openUser");
      if (!raw) return;
      var id = Number(raw);
      if (!Number.isFinite(id)) return;
      u.searchParams.delete("openUser");
      var qs = u.searchParams.toString();
      history.replaceState({}, "", u.pathname + (qs ? "?" + qs : "") + u.hash);
      window.abAdminOpenSupportChat(id);
    } catch (_) {}
  }

  function filterUsers(users) {
    if (adminTab === "new") {
      return users.filter(function (u) {
        return (u.unread_count || 0) > 0;
      });
    }
    if (adminTab === "unanswered") {
      return users.filter(function (u) {
        return u.last_is_staff === 0;
      });
    }
    return users;
  }

  function renderUserList() {
    if (!listEl) return;
    const users = filterUsers(allUsersCache);
    if (!users.length) {
      var emptyMsg = supportThreadSearch
        ? "Ничего не найдено. Попробуйте другой номер или фразу из переписки."
        : "Нет диалогов в этой категории";
      listEl.innerHTML = '<p class="admin-user-list__empty">' + esc(emptyMsg) + "</p>";
      return;
    }
    listEl.innerHTML = users
      .map(function (u) {
        const prev = u.last_body ? esc(u.last_body).slice(0, 80) : "—";
        const badge = u.unread_count > 0 ? String(u.unread_count) : "";
        return (
          '<button type="button" class="admin-user-item" data-id="' +
          u.id +
          '"><div class="admin-user-item__row"><div><p class="admin-user-item__name">' +
          esc(u.name) +
          '</p><p class="admin-user-item__preview">' +
          prev +
          '</p></div><span class="admin-user-item__badge">' +
          badge +
          "</span></div></button>"
        );
      })
      .join("");

    listEl.querySelectorAll(".admin-user-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const id = Number(btn.getAttribute("data-id"));
        selectedId = id;
        listEl.querySelectorAll(".admin-user-item").forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
        });
        if (empty) empty.hidden = true;
        if (thread) thread.hidden = false;
        syncAdminMobileChatShell();
        loadThread(id).catch(function (e) {
          alert(e.message || "Ошибка загрузки");
        });
      });
    });
  }

  /** Пользователь без истории в чате не приходит с /api/admin/users — оставляем его в списке, если диалог уже открыт. */
  function mergeOpenThreadIntoUserList() {
    if (selectedId == null || !selectedUserData) return;
    var uid = Number(selectedId);
    if (!Number.isFinite(uid) || Number(selectedUserData.id) !== uid) return;
    if (allUsersCache.some(function (u) {
      return Number(u.id) === uid;
    })) {
      return;
    }
    allUsersCache.unshift({
      id: selectedUserData.id,
      phone: selectedUserData.phone,
      name: selectedUserData.name,
      locality: selectedUserData.locality || "",
      role: selectedUserData.role || "user",
      blocked: !!selectedUserData.blocked,
      last_body: null,
      last_at: null,
      last_is_staff: null,
      unread_count: 0,
    });
  }

  async function loadUsers() {
    const qs =
      supportThreadSearch.length > 0 ? "?search=" + encodeURIComponent(supportThreadSearch) : "";
    const data = await apiJson("/api/admin/users" + qs, {
      headers: authHeaders(),
      cache: "no-store",
    });
    allUsersCache = data.users || [];
    mergeOpenThreadIntoUserList();
    renderUserList();
    if (selectedId != null) {
      const still = allUsersCache.some(function (u) {
        return Number(u.id) === Number(selectedId);
      });
      if (!still) {
        var loadingThis =
          threadLoadUserId != null && Number(threadLoadUserId) === Number(selectedId);
        if (!loadingThis) {
          selectedId = null;
          if (thread) thread.hidden = true;
          if (empty) empty.hidden = false;
          syncAdminMobileChatShell();
        }
      } else {
        if (listEl) {
          listEl.querySelectorAll(".admin-user-item").forEach(function (b) {
            b.classList.toggle("is-active", Number(b.getAttribute("data-id")) === Number(selectedId));
          });
        }
      }
    }
  }

  function clearUserTypingDotsTimer() {
    if (userTypingDotsTimer != null) {
      clearInterval(userTypingDotsTimer);
      userTypingDotsTimer = null;
    }
  }

  function mountUserTypingIndicator() {
    if (!messagesEl || !userTypingInThreadActive) return;
    var el = document.getElementById("admin-typing-indicator");
    if (!el) {
      el = document.createElement("div");
      el.id = "admin-typing-indicator";
      el.className = "admin-typing-indicator";
      el.setAttribute("aria-live", "polite");
      messagesEl.appendChild(el);
    } else {
      messagesEl.appendChild(el);
    }
    el.hidden = false;
    clearUserTypingDotsTimer();
    var phase = 0;
    function tick() {
      var dots = phase === 0 ? "." : phase === 1 ? ".." : "...";
      el.textContent = "Печатает" + dots;
      phase = (phase + 1) % 3;
    }
    tick();
    userTypingDotsTimer = window.setInterval(tick, 450);
  }

  function setUserTypingIndicatorVisible(active) {
    userTypingInThreadActive = !!active;
    if (!active) {
      clearUserTypingDotsTimer();
      var el = document.getElementById("admin-typing-indicator");
      if (el) el.remove();
      return;
    }
    mountUserTypingIndicator();
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function resendAdminTypingFromInput() {
    if (selectedId == null) return;
    var inp = document.getElementById("admin-reply-input");
    if (!inp) return;
    var v = String(inp.value).trim();
    sendAdminTyping(!!v);
  }

  function sendAdminTyping(active) {
    if (selectedId == null) return;
    fetch("/api/admin/typing", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedId, active: !!active }),
      cache: "no-store",
    }).catch(function () {});
  }

  function stopUserTypingPoll() {
    if (userTypingPollTimer != null) {
      clearInterval(userTypingPollTimer);
      userTypingPollTimer = null;
    }
  }

  function stopThreadLastActiveTicker() {
    if (threadLastActiveTimer != null) {
      clearInterval(threadLastActiveTimer);
      threadLastActiveTimer = null;
    }
  }

  function renderThreadMetaFromSelectedUser() {
    if (!threadMeta || !selectedUserData) return;
    threadMeta.textContent = buildThreadMeta(selectedUserData);
  }

  function startThreadLastActiveTicker() {
    stopThreadLastActiveTicker();
    if (!selectedUserData || !thread || thread.hidden) return;
    renderThreadMetaFromSelectedUser();
    threadLastActiveTimer = window.setInterval(function () {
      if (!selectedUserData || !thread || thread.hidden) return;
      renderThreadMetaFromSelectedUser();
    }, 30 * 1000);
  }

  function startUserTypingPoll(userId) {
    stopUserTypingPoll();
    if (userId == null) return;
    function tick() {
      if (selectedId !== userId) return;
      fetch("/api/admin/users/" + userId + "/typing", {
        headers: authHeaders(),
        cache: "no-store",
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (selectedId !== userId) return;
          if (typeof data.user_typing === "boolean") {
            setUserTypingIndicatorVisible(data.user_typing);
          }
        })
        .catch(function () {});
    }
    userTypingPollTimer = window.setInterval(tick, 1200);
    tick();
  }

  function renderMessages(messages) {
    if (!messagesEl) return;
    if (!messages || !messages.length) {
      messagesEl.innerHTML = '<p style="color:#9ca3af;text-align:center;margin:auto 0;">Нет сообщений</p>';
      if (userTypingInThreadActive) mountUserTypingIndicator();
      return;
    }
    messagesEl.innerHTML = messages
      .map(function (m) {
        const staff = m.is_staff;
        const rowClass = staff ? "admin-msg-row admin-msg-row--staff" : "admin-msg-row admin-msg-row--user";
        const bubbleClass = staff
          ? "admin-msg-bubble admin-msg-bubble--staff"
          : "admin-msg-bubble admin-msg-bubble--user";
        const who = staff ? "Поддержка" : "Пользователь";
        return (
          '<div class="' +
          rowClass +
          '"><div class="' +
          bubbleClass +
          '"><div class="admin-msg-bubble__meta">' +
          esc(who) +
          " · " +
          formatTime(m.created_at) +
          "</div>" +
          messageDeleteButtonHtml(m) +
          messageBubbleInnerHtml(m) +
          "</div></div>"
        );
      })
      .join("");
    if (userTypingInThreadActive) mountUserTypingIndicator();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendAdminMessage(m) {
    if (!messagesEl) return;
    if (!m.is_staff) setUserTypingIndicatorVisible(false);
    const emptyP = messagesEl.querySelector("p");
    if (emptyP && emptyP.textContent === "Нет сообщений") emptyP.remove();
    const staff = m.is_staff;
    const rowClass = staff ? "admin-msg-row admin-msg-row--staff" : "admin-msg-row admin-msg-row--user";
    const bubbleClass = staff
      ? "admin-msg-bubble admin-msg-bubble--staff"
      : "admin-msg-bubble admin-msg-bubble--user";
    const who = staff ? "Поддержка" : "Пользователь";
    const div = document.createElement("div");
    div.className = rowClass;
    div.innerHTML =
      '<div class="' +
      bubbleClass +
      '"><div class="admin-msg-bubble__meta">' +
      esc(who) +
      " · " +
      formatTime(m.created_at) +
      "</div>" +
      messageDeleteButtonHtml(m) +
      messageBubbleInnerHtml(m) +
      "</div>";
    messagesEl.appendChild(div);
    if (userTypingInThreadActive) mountUserTypingIndicator();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function openEditModal() {
    if (!selectedUserData || !modalEditUser) return;
    const n = document.getElementById("edit-user-name");
    const p = document.getElementById("edit-user-phone");
    const loc = document.getElementById("edit-user-locality");
    if (n) n.value = selectedUserData.name || "";
    if (p) p.value = formatRuPhone(selectedUserData.phone || "");
    if (loc) loc.value = selectedUserData.locality || "";
    var pn = document.getElementById("edit-user-password-new");
    var pc = document.getElementById("edit-user-password-confirm");
    if (pn) pn.value = "";
    if (pc) pc.value = "";
    modalEditUser.classList.add("is-open");
    modalEditUser.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeEditModal() {
    if (!modalEditUser) return;
    modalEditUser.classList.remove("is-open");
    modalEditUser.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  /** С вкладки «Пользователи»: открыть модалку редактирования без переключения на поддержку. */
  window.abAdminOpenUserEdit = function (user) {
    if (!user || user.id == null) return;
    selectedId = Number(user.id);
    selectedUserData = {
      id: selectedId,
      name: user.name || "",
      phone: user.phone || "",
      locality: user.locality || "",
      role: user.role || "user",
      blocked: !!user.blocked,
    };
    openEditModal();
  };

  function bindEditPhoneInput(el) {
    if (!el) return;
    el.addEventListener("input", function () {
      const start = el.selectionStart;
      const before = el.value;
      let d = String(before).replace(/\D/g, "");
      if (d.length === 0) {
        el.value = "";
        return;
      }
      if (d[0] === "8") d = "7" + d.slice(1);
      if (d[0] === "9") d = "7" + d;
      if (d[0] !== "7") d = "7" + d.replace(/^7+/, "");
      d = d.slice(0, 11);
      let out = "+7";
      if (d.length > 1) out += " (" + d.slice(1, 4);
      if (d.length >= 4) out += ")";
      if (d.length > 4) out += " " + d.slice(4, 7);
      if (d.length > 7) out += "-" + d.slice(7, 9);
      if (d.length > 9) out += "-" + d.slice(9, 11);
      el.value = out;
      try {
        const diff = out.length - before.length;
        if (start != null) el.setSelectionRange(start + diff, start + diff);
      } catch (_) {}
    });
  }

  async function loadThread(userId) {
    var uid = Number(userId);
    threadLoadUserId = Number.isFinite(uid) ? uid : null;
    stopUserTypingPoll();
    setUserTypingIndicatorVisible(false);
    try {
      const data = await apiJson("/api/admin/users/" + userId + "/messages", {
        headers: authHeaders(),
        cache: "no-store",
      });
      selectedUserData = data.user;
      if (threadName) threadName.textContent = data.user.name;
      renderThreadMetaFromSelectedUser();
      startThreadLastActiveTicker();
      renderMessages(data.messages);
      if (typeof data.user_typing === "boolean") {
        setUserTypingIndicatorVisible(data.user_typing);
      }
      startUserTypingPoll(userId);
      await loadUsers().catch(function () {});
    } finally {
      if (threadLoadUserId === uid) threadLoadUserId = null;
      syncAdminMobileChatShell();
    }
  }

  function authHeaders() {
    const x = loadSession();
    if (!x || !x.token) return {};
    return { Authorization: "Bearer " + x.token };
  }

  function bindTabs() {
    document.querySelectorAll(".admin-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const tab = btn.getAttribute("data-tab");
        if (tab !== "all" && tab !== "new" && tab !== "unanswered") return;
        adminTab = tab;
        document.querySelectorAll(".admin-tab").forEach(function (b) {
          const on = b === btn;
          b.classList.toggle("admin-tab--active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        renderUserList();
      });
    });
  }

  function bindSupportThreadSearch() {
    var inp = document.getElementById("admin-support-thread-search");
    if (!inp) return;
    /** @type {ReturnType<typeof setTimeout> | null} */
    var debounceTimer = null;
    function runLoad() {
      loadUsers().catch(function (e) {
        if (e.status === 403 || e.status === 401) {
          location.replace(e.status === 401 ? "/" : "/home");
        }
      });
    }
    inp.addEventListener("input", function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        var next = String(inp.value || "").trim();
        if (next === supportThreadSearch) return;
        supportThreadSearch = next;
        runLoad();
      }, 350);
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      inp.value = "";
      if (supportThreadSearch === "") return;
      supportThreadSearch = "";
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      runLoad();
    });
  }

  /** Разделы админки — обычные ссылки, полная перезагрузка (не SPA). */
  function bindAdminSectionNav() {
    /* no-op: навигация через href без intercept */
  }

  function bindAdminRail() {
    var root = document.getElementById("admin-root");
    var rail = document.getElementById("admin-rail");
    var backdrop = document.getElementById("admin-rail-backdrop");
    var toggleRail = document.getElementById("admin-rail-toggle");
    var toggleTop = document.getElementById("admin-topbar-menu");
    if (!root || !rail) return;

    var mobileMq = window.matchMedia("(max-width: 899px)");
    var desktopExpanded = false;
    var mobileOpen = false;

    function isMobile() {
      return mobileMq.matches;
    }

    function syncAria() {
      var open = isMobile() ? mobileOpen : desktopExpanded;
      [toggleRail, toggleTop].forEach(function (btn) {
        if (!btn) return;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      if (backdrop) {
        var showBackdrop = isMobile() && mobileOpen;
        backdrop.hidden = !showBackdrop;
        backdrop.setAttribute("aria-hidden", showBackdrop ? "false" : "true");
      }
    }

    function applyRailState() {
      rail.classList.toggle("is-expanded", !isMobile() && desktopExpanded);
      root.classList.toggle("is-rail-expanded", !isMobile() && desktopExpanded);
      root.classList.toggle("is-mobile-nav-open", isMobile() && mobileOpen);
      document.documentElement.classList.toggle("admin-nav-scroll-lock", isMobile() && mobileOpen);
      syncAria();
    }

    function closeMobileNav() {
      if (!mobileOpen) return;
      mobileOpen = false;
      applyRailState();
    }

    function toggleDesktopRail() {
      if (isMobile()) return;
      desktopExpanded = !desktopExpanded;
      applyRailState();
    }

    function toggleMobileNav() {
      if (!isMobile()) return;
      mobileOpen = !mobileOpen;
      applyRailState();
    }

    function onLayoutChange() {
      if (!isMobile()) {
        mobileOpen = false;
      } else {
        desktopExpanded = false;
      }
      applyRailState();
    }

    if (toggleRail) {
      toggleRail.addEventListener("click", function () {
        if (isMobile()) toggleMobileNav();
        else toggleDesktopRail();
      });
    }
    if (toggleTop) {
      toggleTop.addEventListener("click", toggleMobileNav);
    }
    if (backdrop) {
      backdrop.addEventListener("click", closeMobileNav);
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isMobile() && mobileOpen) closeMobileNav();
    });
    rail.querySelectorAll(".admin-nav__link, .admin-rail__exit").forEach(function (link) {
      link.addEventListener("click", function () {
        if (isMobile()) closeMobileNav();
      });
    });
    try {
      if (mobileMq.addEventListener) mobileMq.addEventListener("change", onLayoutChange);
      else if (mobileMq.addListener) mobileMq.addListener(onLayoutChange);
    } catch (_) {
      window.addEventListener("resize", onLayoutChange);
    }
    applyRailState();
  }

  function bindAdminExitNav() {
    document.querySelectorAll("a.admin-exit[href]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (typeof e.button === "number" && e.button !== 0) return;
        var href = String(a.getAttribute("href") || "/home");
        e.preventDefault();
        location.href = href;
      });
    });
  }

  function isStaffSession(role, isStaff) {
    if (isStaff === true) return true;
    var r = String(role == null ? "" : role)
      .trim()
      .toLowerCase();
    return (
      r === "admin" ||
      r === "owner" ||
      r === "developer" ||
      r === "moderator" ||
      r === "support" ||
      r === "financier"
    );
  }

  window.abAdminCanAssignRoles = function () {
    var r = String(adminSessionRole || "")
      .trim()
      .toLowerCase();
    return r === "admin" || r === "owner" || r === "developer" || r === "moderator";
  };

  async function bootstrap() {
    await waitForAdminDom(4000);
    const s = loadSession();
    if (!s || !s.token) {
      if (adminLoading) adminLoading.hidden = true;
      location.replace("/");
      return;
    }
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
      try {
        writeAuthCookie(merged.token);
      } catch (_) {}
      adminSessionRole = merged.role;
      adminStaffAreas = resolveAdminStaffAreas(merged.role, me.user.is_staff, me.user.staff_areas);
      window.abAdminStaffAreas = adminStaffAreas.slice();
      if (!isStaffSession(merged.role, me.user.is_staff)) {
        if (adminLoading) adminLoading.hidden = true;
        location.replace("/home");
        return;
      }
      if (!adminStaffAreas.length) {
        if (adminLoading) adminLoading.hidden = true;
        location.replace("/home");
        return;
      }
      runWhenAdminDomReady(function () {
        showApp();
        init();
      });
    } catch {
      if (adminLoading) adminLoading.hidden = true;
      location.replace("/");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }

  function init() {
    if (adminDidInit) return;
    adminDidInit = true;
    refreshDomRefs();
    bindTabs();
    bindAdminSectionNav();
    bindAdminRail();
    bindAdminExitNav();
    bindSupportThreadSearch();
    try {
      var mq = window.matchMedia("(max-width: 699px)");
      if (mq && typeof mq.addEventListener === "function") {
        mq.addEventListener("change", syncAdminMobileChatShell);
      } else if (mq && typeof mq.addListener === "function") {
        mq.addListener(syncAdminMobileChatShell);
      }
    } catch (_) {
      window.addEventListener("resize", syncAdminMobileChatShell);
    }

    var btnThreadBack = document.getElementById("btn-admin-thread-back");
    if (btnThreadBack) {
      btnThreadBack.addEventListener("click", function () {
        stopUserTypingPoll();
        stopThreadLastActiveTicker();
        setUserTypingIndicatorVisible(false);
        sendAdminTyping(false);
        selectedId = null;
        selectedUserData = null;
        if (thread) thread.hidden = true;
        if (empty) empty.hidden = false;
        if (listEl) {
          listEl.querySelectorAll(".admin-user-item").forEach(function (b) {
            b.classList.remove("is-active");
          });
        }
        syncAdminMobileChatShell();
      });
    }

    loadUsers()
      .catch(function (e) {
        if (e.status === 403 || e.status === 401) {
          location.replace(e.status === 401 ? "/" : "/home");
        }
      })
      .finally(function () {
        processAdminOpenUserQuery();
      });

    const adminFileInput = document.getElementById("admin-chat-file-input");
    const btnAdminAttach = document.getElementById("btn-admin-chat-attach");

    function setAdminComposerDisabled(disabled) {
      if (input) {
        input.disabled = !!disabled;
      }
      if (btnAdminSend) {
        btnAdminSend.disabled = !!disabled;
      }
      if (btnAdminAttach) {
        btnAdminAttach.disabled = !!disabled;
      }
    }

    function postAdminChatMessage(text, attachment) {
      if (selectedId == null) return Promise.reject(new Error("Нет диалога"));
      var body = { body: text };
      if (attachment) body.attachment = attachment;
      return apiJson("/api/admin/users/" + selectedId + "/messages", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    function deleteAdminMessage(messageId) {
      if (selectedId == null) return Promise.reject(new Error("Нет диалога"));
      var mid = Number(messageId);
      if (!Number.isFinite(mid) || mid <= 0) return Promise.reject(new Error("Некорректный id сообщения"));
      return apiJson("/api/admin/users/" + selectedId + "/messages/" + mid, {
        method: "DELETE",
        headers: authHeaders(),
        cache: "no-store",
      });
    }

    /** @param {File} f */
    function uploadAdminChatFile(f) {
      if (!f || !f.size || selectedId == null) return;
      if (btnAdminSend && btnAdminSend.disabled) return;
      setAdminComposerDisabled(true);
      prepareAdminChatUploadFile(f)
        .then(function (prepared) {
          var fd = new FormData();
          fd.append("file", prepared);
          return fetch("/api/admin/chat/upload", {
            method: "POST",
            headers: authHeaders(),
            body: fd,
          });
        })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
            return data;
          });
        })
        .then(function (data) {
          var inp = document.getElementById("admin-reply-input");
          var caption = inp ? String(inp.value).trim() : "";
          clearTimeout(adminTypingDebounceTimer);
          clearTimeout(adminTypingIdleTimer);
          sendAdminTyping(false);
          return postAdminChatMessage(caption, {
            url: data.url,
            name: data.name,
            mime: data.mime,
          });
        })
        .then(function (data) {
          renderMessages(data.messages || []);
          var inp = document.getElementById("admin-reply-input");
          if (inp) inp.value = "";
          loadUsers().catch(function () {});
        })
        .catch(function (err) {
          alert(err.message || "Ошибка");
        })
        .finally(function () {
          if (adminFileInput) adminFileInput.value = "";
          setAdminComposerDisabled(false);
        });
    }

    if (btnAdminAttach && adminFileInput) {
      btnAdminAttach.addEventListener("click", function () {
        adminFileInput.click();
      });
      adminFileInput.addEventListener("change", function () {
        var f = adminFileInput.files && adminFileInput.files[0];
        if (!f) return;
        uploadAdminChatFile(f);
      });
    }

    const adminChatDropzone = document.getElementById("admin-chat-dropzone");
    if (adminChatDropzone) {
      adminChatDropzone.addEventListener("dragenter", function (e) {
        if (thread && thread.hasAttribute("hidden")) return;
        if (selectedId == null) return;
        e.preventDefault();
        adminChatDropzone.classList.add("is-drag-over");
      });
      adminChatDropzone.addEventListener("dragover", function (e) {
        if (selectedId == null) return;
        e.preventDefault();
        try {
          e.dataTransfer.dropEffect = "copy";
        } catch (_) {}
      });
      adminChatDropzone.addEventListener("dragleave", function (e) {
        e.preventDefault();
        var rel = e.relatedTarget;
        if (rel && adminChatDropzone.contains(/** @type {Node} */ (rel))) return;
        adminChatDropzone.classList.remove("is-drag-over");
      });
      adminChatDropzone.addEventListener("drop", function (e) {
        e.preventDefault();
        adminChatDropzone.classList.remove("is-drag-over");
        if (selectedId == null) return;
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f || !f.size) return;
        uploadAdminChatFile(f);
      });
    }

    if (input) {
      input.addEventListener("paste", function (e) {
        if (selectedId == null) return;
        if (btnAdminSend && btnAdminSend.disabled) return;
        var dt = e.clipboardData;
        if (!dt) return;
        /** @type {File | null} */
        var f = null;
        if (dt.files && dt.files.length) {
          f = dt.files[0];
        } else if (dt.items && dt.items.length) {
          for (var i = 0; i < dt.items.length; i++) {
            if (dt.items[i].kind === "file") {
              f = dt.items[i].getAsFile();
              break;
            }
          }
        }
        if (!f || !f.size) return;
        e.preventDefault();
        uploadAdminChatFile(f);
      });
    }

    if (form && input) {
      input.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" || !e.ctrlKey) return;
        e.preventDefault();
        if (form.requestSubmit) form.requestSubmit();
        else form.dispatchEvent(new Event("submit", { cancelable: true }));
      });
      input.addEventListener("input", function () {
        clearTimeout(adminTypingDebounceTimer);
        clearTimeout(adminTypingIdleTimer);
        var v = String(input.value).trim();
        if (!v) {
          sendAdminTyping(false);
          return;
        }
        adminTypingDebounceTimer = window.setTimeout(function () {
          sendAdminTyping(true);
        }, 350);
        adminTypingIdleTimer = window.setTimeout(function () {
          sendAdminTyping(false);
        }, 2800);
      });
      input.addEventListener("blur", function () {
        clearTimeout(adminTypingDebounceTimer);
        clearTimeout(adminTypingIdleTimer);
        adminTypingDebounceTimer = null;
        adminTypingIdleTimer = null;
        sendAdminTyping(false);
      });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!selectedId) return;
        const text = String(input.value).trim();
        if (!text) return;
        if (btnAdminSend && btnAdminSend.disabled) return;
        clearTimeout(adminTypingDebounceTimer);
        clearTimeout(adminTypingIdleTimer);
        sendAdminTyping(false);
        setAdminComposerDisabled(true);
        postAdminChatMessage(text, null)
          .then(function (data) {
            renderMessages(data.messages || []);
            input.value = "";
            loadUsers().catch(function () {});
          })
          .catch(function (err) {
            alert(err.message || "Ошибка отправки");
          })
          .finally(function () {
            setAdminComposerDisabled(false);
          });
      });
    }

    const cannedWrap = document.getElementById("admin-reply-canned");
    if (cannedWrap && input) {
      cannedWrap.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest && e.target.closest("[data-canned]");
        if (!btn) return;
        var key = btn.getAttribute("data-canned");
        var text = key ? CANNED_ADMIN_REPLIES[key] : "";
        if (!text) return;
        e.preventDefault();
        var cur = String(input.value || "");
        input.value = cur ? cur.replace(/\s+$/, "") + "\n\n" + text : text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      });
    }

    const btnEdit = document.getElementById("btn-admin-edit-user");
    if (btnEdit) {
      btnEdit.addEventListener("click", function () {
        openEditModal();
      });
    }

    const btnUserTickets = document.getElementById("btn-admin-user-tickets");
    if (btnUserTickets) {
      btnUserTickets.addEventListener("click", function () {
        openUserTicketsModal();
      });
    }

    const btnCloseUserTickets = document.getElementById("modal-admin-user-tickets-close");
    if (btnCloseUserTickets) btnCloseUserTickets.addEventListener("click", closeUserTicketsModal);
    if (modalUserTickets) {
      modalUserTickets.addEventListener("click", function (e) {
        if (e.target === modalUserTickets) closeUserTicketsModal();
      });
    }

    if (messagesEl) {
      messagesEl.addEventListener("click", function (e) {
        var target = e.target;
        var btn = target && target.closest ? target.closest("[data-admin-delete-msg]") : null;
        if (!btn) return;
        var messageId = Number(btn.getAttribute("data-admin-delete-msg"));
        if (!Number.isFinite(messageId) || messageId <= 0) return;
        if (!window.confirm("Удалить это сообщение?")) return;
        btn.disabled = true;
        deleteAdminMessage(messageId)
          .then(function (data) {
            renderMessages(data.messages || []);
            return loadUsers().catch(function () {});
          })
          .catch(function (err) {
            alert((err && err.message) || "Не удалось удалить сообщение");
          });
      });
    }

    bindEditPhoneInput(document.getElementById("edit-user-phone"));

    const formEdit = document.getElementById("form-edit-user");
    if (formEdit) {
      formEdit.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!selectedId) return;
        const name = document.getElementById("edit-user-name").value.trim();
        const phone = document.getElementById("edit-user-phone").value.trim();
        const locality = document.getElementById("edit-user-locality").value.trim();
        const pwNewEl = document.getElementById("edit-user-password-new");
        const pwConfEl = document.getElementById("edit-user-password-confirm");
        const pwNew = pwNewEl ? String(pwNewEl.value || "").trim() : "";
        const pwConf = pwConfEl ? String(pwConfEl.value || "").trim() : "";
        if (pwNew || pwConf) {
          if (pwNew !== pwConf) {
            alert("Пароли не совпадают");
            return;
          }
          if (pwNew.length < 6) {
            alert("Пароль не короче 6 символов");
            return;
          }
        }
        const payload = { name, phone, locality };
        if (pwNew) payload.new_password = pwNew;
        apiJson("/api/admin/users/" + selectedId, {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(function (data) {
            selectedUserData = data.user;
            if (threadName) threadName.textContent = data.user.name;
            renderThreadMetaFromSelectedUser();
            startThreadLastActiveTicker();
            if (pwNewEl) pwNewEl.value = "";
            if (pwConfEl) pwConfEl.value = "";
            closeEditModal();
            loadUsers().catch(function () {});
          })
          .catch(function (err) {
            alert(err.message || "Не удалось сохранить");
          });
      });
    }

    const btnCloseEdit = document.getElementById("modal-edit-user-close");
    if (btnCloseEdit) btnCloseEdit.addEventListener("click", closeEditModal);
    if (modalEditUser) {
      modalEditUser.addEventListener("click", function (e) {
        if (e.target === modalEditUser) closeEditModal();
      });
    }
  }
})();
