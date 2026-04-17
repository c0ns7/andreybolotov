(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";
  /** Пара localStorage+cookie: если удалили только cookie — считаем выходом */
  const PAIR_KEY = "ab_sess_pair";
  const SESS_COOKIE = "ab_sess";

  function cookieExists() {
    var parts = document.cookie.split(";");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].trim().indexOf(SESS_COOKIE + "=") === 0) return true;
    }
    return false;
  }

  function setSessionCookie() {
    var sec = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = SESS_COOKIE + "=1; path=/; max-age=31536000; SameSite=Lax" + sec;
  }

  function clearSessionCookie() {
    document.cookie = SESS_COOKIE + "=; path=/; max-age=0";
  }

  /** Сессия в localStorage, не в cookies: при удалении cookies сбрасываем вход */
  function reconcileCookiePair() {
    var s = loadSession();
    if (!s || !s.token) {
      clearSessionCookie();
      try {
        localStorage.removeItem(PAIR_KEY);
      } catch (_) {}
      return;
    }
    if (!cookieExists()) {
      if (!localStorage.getItem(PAIR_KEY)) {
        try {
          localStorage.setItem(PAIR_KEY, "1");
        } catch (_) {}
        setSessionCookie();
      } else {
        clearSession();
        authVerified = false;
      }
    }
  }

  /** @type {{ token: string; phone: string; name: string; email: string; role?: string } | null} */
  let session = null;

  /** true только после успешного /api/auth/me или сразу после входа/регистрации */
  let authVerified = false;
  let authCheckInFlight = false;

  /** Доступ к сайту закрыт (сессия есть, выход недоступен) */
  let accountBlocked = false;

  let appView = "feed";

  /** @type {WebSocket | null} */
  let chatWs = null;
  /** @type {WebSocket | null} */
  let liveWs = null;
  let liveWsReconnectTimer = null;
  let raffleTicketsRealtimeInFlight = false;
  let raffleTicketsRealtimeQueued = false;
  let raffleGridRealtimeInFlight = false;
  let raffleGridRealtimeQueued = false;
  let raffleGridRealtimeLastRid = 0;
  /** @type {number | null} */
  let chatMessagesPollTimer = null;
  /** @type {number | null} */
  let chatUnreadPollTimer = null;

  let staffTypingActive = false;
  /** @type {number | null} */
  let staffTypingDotsTimer = null;
  /** @type {number | null} */
  let userTypingDebounceTimer = null;
  /** @type {number | null} */
  let userTypingIdleTimer = null;

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

  /** Убираем /index.html и хвостовой / — иначе /home/raffle/index.html не совпадает с /home/raffle */
  function normalizeAppPath(pathname) {
    var p = String(pathname || "/");
    p = p.replace(/\/index\.html$/i, "");
    p = p.replace(/\/$/, "") || "/";
    return p;
  }
  var routePath = normalizeAppPath(location.pathname);
  var IS_GUEST_LANDING = routePath === "/";
  var IS_HOME_APP = routePath === "/home";
  var IS_RAFFLE_PURCHASE_PAGE = routePath === "/home/raffle";
  var IS_RAFFLE_PAY_PAGE = routePath === "/home/raffle/pay";
  var IS_RAFFLE_CONFIRM_PAGE = routePath === "/home/raffle/confirm";
  var IS_MAINTENANCE_PAGE = routePath === "/maintenance";
  var IS_HOME_RESET_PAGE = routePath === "/home/reset-password";
  var IS_HOME_SETTINGS_PAGE = routePath === "/home/settings";

  function applyStoredAppearance() {
    try {
      var r = document.documentElement;
      if (localStorage.getItem("ab_theme") === "dark") r.classList.add("theme-dark");
      else r.classList.remove("theme-dark");
      if (localStorage.getItem("ab_a11y_large") === "1") r.classList.add("a11y-large-text");
      else r.classList.remove("a11y-large-text");
      if (localStorage.getItem("ab_a11y_contrast") === "1") r.classList.add("a11y-high-contrast");
      else r.classList.remove("a11y-high-contrast");
      if (localStorage.getItem("ab_a11y_reduce_motion") === "1") r.classList.add("reduce-motion");
      else r.classList.remove("reduce-motion");
    } catch (_) {}
  }
  applyStoredAppearance();

  function redirectByRoute() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var j = raw ? JSON.parse(raw) : null;
      var hasLocal = !!(j && j.token && j.phone);
      if (IS_GUEST_LANDING && hasLocal) {
        location.replace("/home");
        return true;
      }
      if (
        (IS_HOME_APP ||
          IS_RAFFLE_PURCHASE_PAGE ||
          IS_RAFFLE_PAY_PAGE ||
          IS_RAFFLE_CONFIRM_PAGE ||
          IS_HOME_SETTINGS_PAGE) &&
        !hasLocal
      ) {
        location.replace("/");
        return true;
      }
    } catch (_) {
      if (
        IS_HOME_APP ||
        IS_RAFFLE_PURCHASE_PAGE ||
        IS_RAFFLE_PAY_PAGE ||
        IS_RAFFLE_CONFIRM_PAGE ||
        IS_HOME_SETTINGS_PAGE
      ) {
        location.replace("/");
        return true;
      }
    }
    return false;
  }
  if (redirectByRoute()) return;

  (function enqueueMaintenanceRedirect() {
    if (IS_MAINTENANCE_PAGE || IS_GUEST_LANDING) return;
    var need =
      (IS_HOME_APP ||
        IS_RAFFLE_PURCHASE_PAGE ||
        IS_RAFFLE_PAY_PAGE ||
        IS_RAFFLE_CONFIRM_PAGE ||
        IS_HOME_SETTINGS_PAGE) &&
      !IS_HOME_RESET_PAGE;
    if (!need) return;
    fetch("/api/site/status", { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.maintenance) return;
        var raw;
        try {
          raw = localStorage.getItem(STORAGE_KEY);
        } catch (_) {
          raw = null;
        }
        var jtok = null;
        if (raw) {
          try {
            jtok = JSON.parse(raw);
          } catch (_) {
            jtok = null;
          }
        }
        var hasTok = !!(jtok && jtok.token);
        if (!hasTok) {
          location.replace("/maintenance");
          return;
        }
        fetch("/api/auth/me", {
          headers: { Authorization: "Bearer " + jtok.token },
          cache: "no-store",
        })
          .then(function (r) {
            return r.json().then(function (d) {
              return { ok: r.ok, d: d };
            });
          })
          .then(function (x) {
            if (x.ok && x.d && x.d.user && x.d.user.role === "admin") return;
            location.replace("/maintenance");
          })
          .catch(function () {
            location.replace("/maintenance");
          });
      })
      .catch(function () {});
  })();

  function saveSession(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    session = data;
    if (data && data.token) {
      try {
        localStorage.setItem(PAIR_KEY, "1");
      } catch (_) {}
      setSessionCookie();
    }
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("ab_auth_demo");
    try {
      localStorage.removeItem(PAIR_KEY);
    } catch (_) {}
    clearSessionCookie();
    session = null;
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
      if (res.status === 403 && data.code === "account_blocked") {
        accountBlocked = true;
        refreshAccountBlockedUI();
        renderDashboard();
        const err = new Error(data.error || data.message || "Аккаунт заблокирован");
        err.status = 403;
        err.accountBlocked = true;
        throw err;
      }
      if (res.status === 503 && data.code === "maintenance") {
        try {
          location.replace("/maintenance");
        } catch (_) {}
        const err = new Error(data.error || data.message || "Технические работы");
        err.status = 503;
        err.maintenance = true;
        throw err;
      }
      if (res.status === 401 && headers.Authorization) {
        invalidateSession("Сессия истекла. Войдите снова.");
      }
      const err = new Error(
        res.status === 401 ? "SESSION_EXPIRED" : data.error || data.message || "Ошибка запроса",
      );
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function invalidateSession(toastMsg) {
    clearSession();
    authVerified = false;
    accountBlocked = false;
    refreshAccountBlockedUI();
    session = null;
    appView = "feed";
    stopChatUnreadPolling();
    setChatTabUnreadHighlight(false);
    closeChatPanel();
    disconnectLiveWs();
    closeAllModals();
    updateScreens();
    setBottomNavActive();
    if (toastMsg) showToast(toastMsg, "error");
  }

  function authHeaders() {
    const s = loadSession();
    if (!s || !s.token) return {};
    return { Authorization: "Bearer " + s.token };
  }

  // --- Russian phone
  function digitsOnly(s) {
    return String(s).replace(/\D/g, "");
  }

  function formatRuPhone(input) {
    let d = digitsOnly(input);
    if (d.length === 0) return "";
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
    return out;
  }

  function phoneToNormalized(digits) {
    let d = digitsOnly(digits);
    if (d[0] === "8") d = "7" + d.slice(1);
    if (d[0] === "9") d = "7" + d;
    if (d[0] !== "7") d = "7" + d.replace(/^7+/, "");
    return d.slice(0, 11);
  }

  function isValidRuMobilePhone(phone) {
    return /^79\d{9}$/.test(phone);
  }

  function formatChatTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return hh + ":" + mm;
  }

  function ticksHtml(m) {
    if (m.is_staff) return "";
    var read = !!m.read_by_staff;
    var cls = "chat-bubble__ticks" + (read ? " chat-bubble__ticks--read" : "");
    var label = read ? "Прочитано поддержкой" : "Доставлено";
    var ticks = read ? "✓✓" : "✓";
    return '<span class="' + cls + '" aria-label="' + label + '" title="' + label + '">' + ticks + "</span>";
  }

  function escapeChatHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function chatAttachmentHtml(m) {
    if (!m.attachment_url) return "";
    var url = String(m.attachment_url).replace(/"/g, "&quot;");
    var name = escapeChatHtml(m.attachment_name || "файл");
    var mime = String(m.attachment_mime || "");
    if (/^image\//i.test(mime)) {
      return (
        '<div class="chat-attachment chat-attachment--img"><a href="' +
        url +
        '" target="_blank" rel="noopener noreferrer"><img src="' +
        url +
        '" alt="" loading="lazy"/></a></div>'
      );
    }
    return (
      '<div class="chat-attachment chat-attachment--file"><a class="chat-attachment__link" href="' +
      url +
      '" target="_blank" rel="noopener noreferrer" download>📎 ' +
      name +
      "</a></div>"
    );
  }

  function chatBubbleHtml(m) {
    const out = !m.is_staff;
    const rowClass = out ? "chat-bubble-row chat-bubble-row--out" : "chat-bubble-row chat-bubble-row--in";
    const bClass = out ? "chat-bubble chat-bubble--out" : "chat-bubble chat-bubble--in";
    const att = chatAttachmentHtml(m);
    const bodyRaw = String(m.body || "").trim();
    const textBlock = bodyRaw ? '<div class="chat-bubble__text">' + escapeChatHtml(m.body) + "</div>" : "";
    const time = formatChatTime(m.created_at);
    const meta = out
      ? '<div class="chat-bubble__meta--out"><span class="chat-bubble__time">' + time + "</span>" + ticksHtml(m) + "</div>"
      : '<span class="chat-bubble__time">' + time + "</span>";
    return '<div class="' + rowClass + '"><div class="' + bClass + '">' + att + textBlock + meta + "</div></div>";
  }

  function setAppView(_view) {
    appView = "feed";
    setBottomNavActive();
  }

  function setBottomNavActive() {
    const tabSearch = document.getElementById("tab-search");
    const tabChat = document.getElementById("tab-chat");
    const tabCart = document.getElementById("tab-cart");
    const tabTickets = document.getElementById("tab-tickets");
    const tabProfile = document.getElementById("tab-profile");
    const panelChat = document.getElementById("panel-chat");
    const modalProfileEl = document.getElementById("modal-profile");
    const chatOpen = panelChat && !panelChat.classList.contains("screen--hidden");
    const profileOpen = modalProfileEl && modalProfileEl.classList.contains("is-open");
    const cartOpen = modalCart && modalCart.classList.contains("is-open");
    const ticketsOpen = modalTickets && modalTickets.classList.contains("is-open");
    const searchOpen = modalTicketSearch && modalTicketSearch.classList.contains("is-open");

    [tabSearch, tabChat, tabCart, tabTickets, tabProfile].forEach(function (el) {
      if (el) el.classList.remove("bottom-nav-btn--active");
    });

    if (searchOpen && tabSearch) tabSearch.classList.add("bottom-nav-btn--active");
    else if (cartOpen && tabCart) tabCart.classList.add("bottom-nav-btn--active");
    else if (ticketsOpen && tabTickets) tabTickets.classList.add("bottom-nav-btn--active");
    else if (chatOpen && tabChat) tabChat.classList.add("bottom-nav-btn--active");
    else if (profileOpen && tabProfile) tabProfile.classList.add("bottom-nav-btn--active");
  }

  function clearStaffTypingAnimation() {
    if (staffTypingDotsTimer != null) {
      clearInterval(staffTypingDotsTimer);
      staffTypingDotsTimer = null;
    }
  }

  function mountStaffTypingIndicator() {
    const box = document.getElementById("chat-messages");
    if (!box || !staffTypingActive) return;
    let el = document.getElementById("chat-typing-indicator");
    if (!el) {
      el = document.createElement("div");
      el.id = "chat-typing-indicator";
      el.className = "chat-typing-indicator";
      el.setAttribute("aria-live", "polite");
      box.appendChild(el);
    } else {
      box.appendChild(el);
    }
    el.hidden = false;
    clearStaffTypingAnimation();
    var phase = 0;
    function tick() {
      var dots = phase === 0 ? "." : phase === 1 ? ".." : "...";
      el.textContent = "Печатает" + dots;
      phase = (phase + 1) % 3;
    }
    tick();
    staffTypingDotsTimer = window.setInterval(tick, 450);
  }

  function setStaffTypingVisible(active) {
    staffTypingActive = !!active;
    if (!active) {
      clearStaffTypingAnimation();
      var el = document.getElementById("chat-typing-indicator");
      if (el) el.remove();
      return;
    }
    mountStaffTypingIndicator();
    var box = document.getElementById("chat-messages");
    if (box) box.scrollTop = box.scrollHeight;
  }

  function resendUserTypingFromInput() {
    var ci = document.getElementById("chat-input");
    if (!ci || !chatWs || chatWs.readyState !== WebSocket.OPEN) return;
    var v = String(ci.value).trim();
    try {
      chatWs.send(JSON.stringify({ type: "typing", active: !!v }));
    } catch (_) {}
  }

  function sendUserTyping(active) {
    var v = !!active;
    var payload = JSON.stringify({ type: "typing", active: v });
    if (chatWs && chatWs.readyState === WebSocket.OPEN) {
      try {
        chatWs.send(payload);
      } catch (_) {}
    }
    /* HTTP — работает даже без WS (прокси / тот же origin) */
    fetch("/api/chat/typing", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ active: v }),
      cache: "no-store",
    }).catch(function () {});
  }

  function renderChatMessages(messages) {
    const box = document.getElementById("chat-messages");
    if (!box) return;
    if (!messages || !messages.length) {
      box.innerHTML =
        '<p class="chat-empty" style="text-align:center;color:#9ca3af;font-size:0.85rem;margin:auto 0;">Напишите нам — ответим в порядке очереди.</p>';
      if (staffTypingActive) mountStaffTypingIndicator();
      return;
    }
    box.innerHTML = messages.map(chatBubbleHtml).join("");
    if (staffTypingActive) mountStaffTypingIndicator();
    box.scrollTop = box.scrollHeight;
  }

  async function loadChatMessagesHttp() {
    const s = loadSession();
    if (!s || !s.token || !authVerified) return;
    try {
      const data = await apiJson("/api/chat/messages", {
        headers: authHeaders(),
        cache: "no-store",
      });
      renderChatMessages(data.messages || []);
      if (typeof data.staff_typing === "boolean") {
        setStaffTypingVisible(data.staff_typing);
      }
    } catch (_) {
      /* ignore */
    }
  }

  function setChatTabUnreadHighlight(on) {
    var tab = document.getElementById("tab-chat");
    if (!tab) return;
    tab.classList.toggle("bottom-nav-btn--chat-unread", !!on);
  }

  function refreshChatUnreadCount() {
    var s = loadSession();
    if (!s || !s.token || !authVerified || accountBlocked) {
      setChatTabUnreadHighlight(false);
      return;
    }
    var panel = document.getElementById("panel-chat");
    if (panel && !panel.classList.contains("screen--hidden")) {
      setChatTabUnreadHighlight(false);
      return;
    }
    fetch("/api/chat/unread", { headers: authHeaders(), cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        setChatTabUnreadHighlight((Number(j.unread_staff) || 0) > 0);
      })
      .catch(function () {});
  }

  function stopChatUnreadPolling() {
    if (chatUnreadPollTimer != null) {
      clearInterval(chatUnreadPollTimer);
      chatUnreadPollTimer = null;
    }
  }

  function startChatUnreadPolling() {
    stopChatUnreadPolling();
    refreshChatUnreadCount();
    chatUnreadPollTimer = window.setInterval(refreshChatUnreadCount, 24000);
  }

  function postMarkStaffChatRead() {
    return fetch("/api/chat/mark-staff-read", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    }).catch(function () {});
  }

  function startChatMessagesPolling() {
    stopChatMessagesPolling();
    chatMessagesPollTimer = window.setInterval(function () {
      var panel = document.getElementById("panel-chat");
      if (!panel || panel.classList.contains("screen--hidden")) return;
      loadChatMessagesHttp();
    }, 2500);
  }

  function stopChatMessagesPolling() {
    if (chatMessagesPollTimer != null) {
      clearInterval(chatMessagesPollTimer);
      chatMessagesPollTimer = null;
    }
  }

  /** Поддержка открыла диалог: WS присылает thread_read — сразу обновляем ✓✓ без ожидания HTTP */
  function markOutgoingChatTicksReadInDom() {
    const box = document.getElementById("chat-messages");
    if (!box) return;
    box.querySelectorAll(".chat-bubble-row--out .chat-bubble__ticks").forEach(function (el) {
      el.classList.add("chat-bubble__ticks--read");
      el.setAttribute("aria-label", "Прочитано поддержкой");
      el.setAttribute("title", "Прочитано поддержкой");
      el.textContent = "✓✓";
    });
  }

  /**
   * Тот же origin, что и страница — в dev Vite проксирует /ws на API :3000 (astro.config.mjs).
   * Прямой ws://…:3000 в браузере часто не работает (файрвол, другой host).
   */
  function buildChatWebSocketUrl(token) {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + "/ws?token=" + encodeURIComponent(token);
  }

  function disconnectChatWs() {
    sendUserTyping(false);
    if (chatWs) {
      try {
        chatWs.close();
      } catch (_) {}
      chatWs = null;
    }
  }

  function disconnectLiveWs() {
    if (liveWsReconnectTimer) {
      clearTimeout(liveWsReconnectTimer);
      liveWsReconnectTimer = null;
    }
    if (liveWs) {
      try {
        liveWs.close();
      } catch (_) {}
      liveWs = null;
    }
  }

  function scheduleLiveWsReconnect() {
    if (liveWsReconnectTimer) return;
    liveWsReconnectTimer = setTimeout(function () {
      liveWsReconnectTimer = null;
      connectLiveWs();
    }, 2000);
  }

  async function handleRaffleTicketsRealtimeUpdate() {
    if (raffleTicketsRealtimeInFlight) {
      raffleTicketsRealtimeQueued = true;
      return;
    }
    raffleTicketsRealtimeInFlight = true;
    try {
      var data = await fetchTicketsFromApi();
      if (modalTickets && modalTickets.classList.contains("is-open")) {
        renderTicketsModalBody(data);
      }
      syncProfileTicketCount();
    } catch (_) {
      // silent realtime failure; next event/poll will recover
    } finally {
      raffleTicketsRealtimeInFlight = false;
      if (raffleTicketsRealtimeQueued) {
        raffleTicketsRealtimeQueued = false;
        handleRaffleTicketsRealtimeUpdate();
      }
    }
  }

  async function pruneRaffleLocalSelectionAgainstServer() {
    if (!IS_RAFFLE_PURCHASE_PAGE || !raffleDetailState.raffle || !raffleDetailState.raffle.id) return 0;
    var rid = Number(raffleDetailState.raffle.id);
    if (!Number.isFinite(rid) || rid < 1) return 0;
    var sel = Array.from(raffleDetailState.selected || []);
    if (!sel.length) return 0;
    var s = loadSession();
    if (!s || !s.token) return 0;
    var removed = 0;
    var tasks = sel.map(function (n) {
      return fetch("/api/raffles/" + String(rid) + "/ticket-lookup?n=" + String(n), {
        cache: "no-store",
        headers: authHeaders(),
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { n: n, kind: d && d.kind, ok: res.ok };
          });
        })
        .catch(function () {
          return { n: n, kind: null, ok: false };
        });
    });
    var look = await Promise.all(tasks);
    for (var i = 0; i < look.length; i++) {
      var L = look[i];
      if (!L || !L.ok || !L.kind) continue;
      if (L.kind === "taken" && raffleDetailState.selected.has(L.n)) {
        raffleDetailState.selected.delete(L.n);
        removed++;
      }
    }
    if (removed) persistRaffleDraftSelection();
    return removed;
  }

  async function handleRaffleGridRealtimeUpdate(raffleIdRemote) {
    var ridRemote = Number(raffleIdRemote);
    if (!Number.isFinite(ridRemote) || ridRemote < 1) return;
    if (raffleGridRealtimeInFlight) {
      raffleGridRealtimeQueued = true;
      raffleGridRealtimeLastRid = ridRemote;
      return;
    }
    raffleGridRealtimeInFlight = true;
    raffleGridRealtimeQueued = false;
    raffleGridRealtimeLastRid = ridRemote;
    try {
      await fetchCartFromApi().catch(function () {});
      if (modalCart && modalCart.classList.contains("is-open")) {
        renderCartModalBody(raffleDataCache.cart ? raffleDataCache.cart.items : []);
      }

      if (
        (IS_RAFFLE_PURCHASE_PAGE || IS_RAFFLE_PAY_PAGE) &&
        raffleDetailState.raffle &&
        Number(raffleDetailState.raffle.id) === ridRemote
      ) {
        var removedSel = 0;
        if (IS_RAFFLE_PURCHASE_PAGE) {
          removedSel = await pruneRaffleLocalSelectionAgainstServer();
          if (removedSel > 0) {
            showToast("Часть номерков уже занята — снята с выбора", "warning");
            scheduleRaffleSelectionSync();
          }
        }
        await loadRaffleTicketSlice().catch(function () {});
        renderRaffleGrid(raffleDetailState.lastCells || []);
        updateRaffleSelectionLabel();
      }
    } catch (_) {
      /* ignore */
    } finally {
      raffleGridRealtimeInFlight = false;
      if (raffleGridRealtimeQueued) {
        raffleGridRealtimeQueued = false;
        var nextRid = raffleGridRealtimeLastRid || ridRemote;
        handleRaffleGridRealtimeUpdate(nextRid);
      }
    }
  }

  async function handleRafflesFeedRealtimeUpdate() {
    if (IS_HOME_APP) {
      loadRafflesFeed().catch(function () {});
    }
    if (IS_RAFFLE_PURCHASE_PAGE || IS_RAFFLE_PAY_PAGE) {
      var r = raffleDetailState.raffle;
      var rid = Number(r && r.id);
      if (!Number.isFinite(rid) || rid < 1) return;
      try {
        var res = await fetch("/api/raffles/" + String(rid), {
          cache: "no-store",
          headers: authHeaders(),
        });
        var data = await res.json().catch(function () {
          return {};
        });
        if (!res.ok || !data.raffle || String(data.raffle.status || "") !== "active") {
          location.replace("/home");
          return;
        }
        raffleDetailState.raffle = data.raffle;
      } catch (_) {
        // keep current page state; next realtime/poll will retry
      }
    }
  }

  function connectLiveWs() {
    disconnectLiveWs();
    const s = loadSession();
    if (!s || !s.token || !authVerified || accountBlocked) return;
    const url = buildChatWebSocketUrl(s.token);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (_) {
      return;
    }
    liveWs = ws;
    ws.onmessage = function (ev) {
      let d;
      try {
        d = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      if (d.type === "raffle_tickets_updated") {
        handleRaffleTicketsRealtimeUpdate();
        return;
      }
      if (d.type === "raffle_grid_updated") {
        handleRaffleGridRealtimeUpdate(d.raffle_id);
        return;
      }
      if (d.type === "raffles_feed_updated") {
        handleRafflesFeedRealtimeUpdate();
      }
    };
    ws.onclose = function () {
      if (liveWs === ws) liveWs = null;
      const s2 = loadSession();
      if (s2 && s2.token && authVerified && !accountBlocked) {
        scheduleLiveWsReconnect();
      }
    };
    ws.onerror = function () {
      // keep silent; onclose will handle reconnect
    };
  }

  function connectChatWs() {
    disconnectChatWs();
    const s = loadSession();
    if (!s || !s.token || !authVerified) return;
    const url = buildChatWebSocketUrl(s.token);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (_) {
      loadChatMessagesHttp();
      return;
    }
    chatWs = ws;
    var gotReady = false;
    ws.onopen = function () {
      resendUserTypingFromInput();
    };
    ws.onmessage = function (ev) {
      let d;
      try {
        d = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      if (d.type === "ready" && Array.isArray(d.messages)) {
        gotReady = true;
        renderChatMessages(d.messages);
        resendUserTypingFromInput();
        return;
      }
      if (d.type === "thread_read") {
        markOutgoingChatTicksReadInDom();
        loadChatMessagesHttp();
        return;
      }
      if (d.type === "typing" && d.from === "staff") {
        setStaffTypingVisible(!!d.active);
        return;
      }
      if (d.type === "chat_message" && d.message) {
        const box = document.getElementById("chat-messages");
        if (!box) return;
        var panel = document.getElementById("panel-chat");
        var chatOpen = panel && !panel.classList.contains("screen--hidden");
        if (d.message.is_staff) setStaffTypingVisible(false);
        const empty = box.querySelector(".chat-empty");
        if (empty) empty.remove();
        const wrap = document.createElement("div");
        wrap.innerHTML = chatBubbleHtml(d.message);
        const row = wrap.firstElementChild;
        if (row) box.appendChild(row);
        if (staffTypingActive) mountStaffTypingIndicator();
        box.scrollTop = box.scrollHeight;
        if (d.message.is_staff && chatOpen) {
          postMarkStaffChatRead().then(function () {
            setChatTabUnreadHighlight(false);
          });
        } else if (d.message.is_staff && !chatOpen) {
          setChatTabUnreadHighlight(true);
        }
      }
    };
    ws.onerror = function () {
      loadChatMessagesHttp();
    };
    ws.onclose = function () {
      if (chatWs === ws) chatWs = null;
      var panel = document.getElementById("panel-chat");
      var open = panel && !panel.classList.contains("screen--hidden");
      if (open && !gotReady) loadChatMessagesHttp();
    };
  }

  function openChatPanel() {
    closeCartModal();
    closeTicketsModal();
    closeTicketSearchModal();
    if (modalProfile) closeModal(modalProfile);
    const panel = document.getElementById("panel-chat");
    if (!panel) return;
    panel.classList.remove("screen--hidden");
    panel.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setChatTabUnreadHighlight(false);
    loadChatMessagesHttp()
      .then(function () {
        return postMarkStaffChatRead();
      })
      .finally(function () {
        refreshChatUnreadCount();
      });
    connectChatWs();
    startChatMessagesPolling();
    setBottomNavActive();
    const input = document.getElementById("chat-input");
    if (input) setTimeout(function () { input.focus(); }, 100);
  }

  function closeChatPanel() {
    const panel = document.getElementById("panel-chat");
    if (!panel) return;
    clearTimeout(userTypingDebounceTimer);
    clearTimeout(userTypingIdleTimer);
    userTypingDebounceTimer = null;
    userTypingIdleTimer = null;
    sendUserTyping(false);
    setStaffTypingVisible(false);
    panel.classList.add("screen--hidden");
    panel.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    disconnectChatWs();
    stopChatMessagesPolling();
    setBottomNavActive();
    refreshChatUnreadCount();
  }

  function renderDashboard() {
    const s = loadSession();
    const authed = !!(s && s.token && s.phone && authVerified);
    const nameHero = document.getElementById("profile-modal-heading");
    const phoneHero = document.getElementById("profile-modal-phone-hero");
    const fieldName = document.getElementById("profile-field-name");
    const fieldPhone = document.getElementById("profile-field-phone");
    const fieldEmail = document.getElementById("profile-field-email");
    const letterEl = document.getElementById("bottom-nav-profile-letter");
    const guestBar = document.getElementById("guest-auth-bar");
    const adminWrap = document.getElementById("profile-admin-wrap");

    if (guestBar) guestBar.style.display = authed ? "none" : "flex";
    if (nameHero && phoneHero && fieldName && fieldPhone && fieldEmail) {
      if (s && s.name) {
        nameHero.textContent = s.name;
        phoneHero.textContent = formatRuPhone(s.phone);
        fieldName.textContent = s.name;
        fieldPhone.textContent = formatRuPhone(s.phone);
        fieldEmail.textContent = s.email || "—";
      } else {
        nameHero.textContent = "";
        phoneHero.textContent = "";
        fieldName.textContent = "";
        fieldPhone.textContent = "";
        fieldEmail.textContent = "";
      }
    }
    if (letterEl) {
      if (s && s.name && String(s.name).trim()) {
        letterEl.textContent = String(s.name).trim().charAt(0).toUpperCase();
      } else {
        letterEl.textContent = "К";
      }
    }
    if (adminWrap) {
      const show = authed && s.role === "admin" && !accountBlocked;
      adminWrap.hidden = !show;
    }
    if (authed) syncProfileTicketCount();
    if (authed) updateCartBuyerDisplay();
  }

  function bindPhoneInput(el) {
    if (!el) return;
    el.addEventListener("input", function () {
      const start = el.selectionStart;
      const before = el.value;
      const formatted = formatRuPhone(el.value);
      el.value = formatted;
      try {
        const diff = formatted.length - before.length;
        if (start != null) el.setSelectionRange(start + diff, start + diff);
      } catch (_) {}
    });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && el.value === "+7 ") {
        e.preventDefault();
        el.value = "";
      }
    });
  }

  function bindPasswordToggle(btn, inputId) {
    if (!btn) return;
    btn.addEventListener("click", function () {
      const input = document.getElementById(inputId);
      if (!input) return;
      const isPwd = input.type === "password";
      input.type = isPwd ? "text" : "password";
      btn.setAttribute("aria-pressed", String(isPwd));
      btn.querySelector(".eye-open").style.display = isPwd ? "none" : "inline";
      btn.querySelector(".eye-closed").style.display = isPwd ? "inline" : "none";
    });
  }

  const welcomeScreen = document.getElementById("screen-welcome");
  const appScreen = document.getElementById("screen-app");

  const modalRegister = document.getElementById("modal-register");
  const modalLogin = document.getElementById("modal-login");
  const modalForgot = document.getElementById("modal-forgot");
  const modalProfile = document.getElementById("modal-profile");
  const modalRaffleUnavailable = document.getElementById("modal-raffle-unavailable");
  const modalCart = document.getElementById("modal-cart");
  const modalTickets = document.getElementById("modal-tickets");
  const modalTicketSearch = document.getElementById("modal-ticket-search");
  const modalReserveSuccess = document.getElementById("modal-reserve-success");
  const modalReservePayment = document.getElementById("modal-reserve-payment");
  const modalWaitReceipt = document.getElementById("modal-wait-receipt");
  const modalReserveExpired = document.getElementById("modal-reserve-expired");
  const modalActionError = document.getElementById("modal-action-error");
  const modalInstallApp = document.getElementById("modal-install-app");

  function detectInstallAppPlatform() {
    var ua = navigator.userAgent || "";
    var iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (iOS) return "ios";
    if (/Android/i.test(ua)) return "android";
    return "desktop";
  }

  function setInstallAppTab(which) {
    var pIos = document.getElementById("install-app-panel-ios");
    var pAnd = document.getElementById("install-app-panel-android");
    var tIos = document.getElementById("install-app-tab-ios");
    var tAnd = document.getElementById("install-app-tab-android");
    if (!pIos || !pAnd) return;
    var isIos = which === "ios";
    pIos.hidden = !isIos;
    pAnd.hidden = isIos;
    if (tIos) {
      tIos.classList.toggle("install-app-seg__btn--active", isIos);
      tIos.setAttribute("aria-selected", isIos ? "true" : "false");
    }
    if (tAnd) {
      tAnd.classList.toggle("install-app-seg__btn--active", !isIos);
      tAnd.setAttribute("aria-selected", isIos ? "false" : "true");
    }
  }

  function syncInstallAppModalLayout() {
    var plat = detectInstallAppPlatform();
    var seg = document.getElementById("install-app-seg");
    var lead = document.getElementById("install-app-lead");
    var wrap = document.getElementById("install-app-prompt-wrap");
    var pIos = document.getElementById("install-app-panel-ios");
    var pAnd = document.getElementById("install-app-panel-android");
    if (plat === "ios") {
      if (seg) seg.hidden = true;
      if (pIos) pIos.hidden = false;
      if (pAnd) pAnd.hidden = true;
      if (lead) {
        lead.textContent =
          "Сайт откроется на весь экран, как отдельное приложение — без лишних элементов браузера.";
      }
      if (wrap) wrap.hidden = true;
    } else if (plat === "android") {
      if (seg) seg.hidden = true;
      if (pIos) pIos.hidden = true;
      if (pAnd) pAnd.hidden = false;
      if (lead) {
        lead.textContent =
          "Добавьте ярлык на главный экран или установите из Chrome — если ниже появится кнопка браузера.";
      }
      if (wrap) wrap.hidden = !deferredInstallPrompt;
    } else {
      if (seg) seg.hidden = false;
      setInstallAppTab("ios");
      if (lead) {
        lead.textContent = "Выберите вашу систему. На телефоне откройте эту страницу и повторите шаги.";
      }
      if (wrap) wrap.hidden = !deferredInstallPrompt;
    }
  }

  function openInstallAppModal() {
    if (!modalInstallApp) return;
    syncInstallAppModalLayout();
    openModal(modalInstallApp);
  }

  function refreshInstallPromptVisibility() {
    var wrap = document.getElementById("install-app-prompt-wrap");
    if (!wrap) return;
    var modal = document.getElementById("modal-install-app");
    if (!modal || !modal.classList.contains("is-open")) return;
    var plat = detectInstallAppPlatform();
    if (plat === "ios") {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = !deferredInstallPrompt;
  }

  var deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    refreshInstallPromptVisibility();
  });

  var ticketsModalDataCache = { reserved: [], pending_review: [], confirmed: [], wholesale_slots: [] };
  var lastCartChromeTotal = -1;
  var ticketSearchLookupTimer = null;
  var ticketSearchLastLookup = { n: NaN, kind: null };
  var raffleFastLookupTimer = null;
  var raffleFastLookupState = { n: NaN, kind: null };
  var ticketSearchRandomQty = 5;
  var ticketsModalActiveTab = "reserved";
  var homeRafflesRefreshTimer = null;
  var raffleViewHeartbeatTimer = null;
  var rafflePageViewersRefreshTimer = null;
  var raffleSelectionSyncTimer = null;
  var raffleSelectionSyncInFlight = false;
  var raffleSelectionSyncQueued = false;
  var raffleDraftHydrated = false;
  var reservePaymentTimerId = null;
  var waitReceiptModalTimerId = null;
  var reserveFlowState = {
    orderId: 0,
    raffleId: 0,
    numbers: [],
    amountRub: 0,
    reservedUntil: 0,
    collectionUrl: "",
    tbankCollectionUrl: "",
    sberCollectionRecipient: "",
    tbankCollectionRecipient: "",
    qrImageUrl: "",
    qrRecipient: "",
    qrPaymentPurpose: "Оплата услуг",
    sberEnabled: true,
    tbankEnabled: false,
    qrEnabled: true,
    paymentMethod: "collection",
  };
  /** Кэш корзины и «Мои билеты» — подгружается после входа, обновляется при мутациях */
  var raffleDataCache = {
    cart: /** @type {{ items: unknown[] } | null} */ (null),
    tickets: /** @type {{ reserved: unknown[]; pending_review?: unknown[]; confirmed: unknown[]; wholesale_slots?: unknown[] } | null} */ (null),
  };
  var lastCartCheckoutAt = 0;
  var lastCartRemoveAt = 0;
  var lastActionErrorRetry = null;
  var reservationReminderTimerId = null;

  /** @type {Array<Record<string, unknown>>} */
  let raffleDetailCache = [];

  function emitUxEvent(name, payload) {
    var body = payload || {};
    try {
      window.dispatchEvent(new CustomEvent("ab:ux", { detail: { event: name, payload: body } }));
    } catch (_) {}
    try {
      if (window.dataLayer && Array.isArray(window.dataLayer)) {
        window.dataLayer.push({ event: "ab_ux", name: name, ...body });
      }
    } catch (_) {}
  }

  function renderFeedSkeleton(targetId) {
    var root = document.getElementById(targetId);
    if (!root) return;
    root.innerHTML =
      '<div class="feed-skeleton" aria-hidden="true">' +
      '<div class="feed-skeleton__card"><div class="feed-skeleton__line feed-skeleton__line--lg"></div><div class="feed-skeleton__line"></div><div class="feed-skeleton__line feed-skeleton__line--sm"></div></div>' +
      '<div class="feed-skeleton__card"><div class="feed-skeleton__line feed-skeleton__line--lg"></div><div class="feed-skeleton__line"></div><div class="feed-skeleton__line feed-skeleton__line--sm"></div></div>' +
      "</div>";
  }

  function renderTicketsLoadingSkeleton() {
    return (
      '<div class="feed-skeleton" aria-hidden="true">' +
      '<div class="feed-skeleton__card"><div class="feed-skeleton__line feed-skeleton__line--lg"></div><div class="feed-skeleton__line"></div><div class="feed-skeleton__line feed-skeleton__line--sm"></div></div>' +
      '<div class="feed-skeleton__card"><div class="feed-skeleton__line feed-skeleton__line--lg"></div><div class="feed-skeleton__line"></div><div class="feed-skeleton__line feed-skeleton__line--sm"></div></div>' +
      "</div>"
    );
  }
  var raffleCardPrevFreePct = Object.create(null);

  const RAFFLE_MAX_SELECT = 25;

  /** Разница «серверное сейчас − локальное Date.now()» по последнему ответу API (неверные часы на устройстве ломали таймер брони). */
  var raffleServerTimeSkewMs = 0;

  /**
   * Остаток брони от последнего снимка (reserved_until − server_time_ms) и отсчёт через performance.now(),
   * чтобы календарные часы устройства не раздували таймер.
   * @type {{ budgetMs: number | null, anchorPerf: number | null }}
   */
  var raffleReserveMonotonic = { budgetMs: null, anchorPerf: null };

  function clearRaffleReservationCountdownAnchor() {
    raffleReserveMonotonic.budgetMs = null;
    raffleReserveMonotonic.anchorPerf = null;
  }

  function armRaffleReservationCountdownFromSnapshot(reservedUntil, serverTimeMs) {
    var u = Number(reservedUntil);
    var s = Number(serverTimeMs);
    if (!Number.isFinite(u) || !Number.isFinite(s)) {
      clearRaffleReservationCountdownAnchor();
      return;
    }
    if (typeof performance === "undefined" || typeof performance.now !== "function") {
      clearRaffleReservationCountdownAnchor();
      return;
    }
    raffleReserveMonotonic.budgetMs = Math.max(0, u - s);
    raffleReserveMonotonic.anchorPerf = performance.now();
  }

  function applyRaffleServerTimeSkewFromPayload(data) {
    if (!data || typeof data !== "object") return;
    var st = Number(data.server_time_ms);
    if (Number.isFinite(st)) {
      raffleServerTimeSkewMs = st - Date.now();
    }
    if (data.order === null) {
      clearRaffleReservationCountdownAnchor();
    }
    if (!Number.isFinite(st)) return;
    var ord = data.order;
    if (ord && ord.reserved_until != null && String(ord.status || "") === "reserved") {
      armRaffleReservationCountdownFromSnapshot(Number(ord.reserved_until), st);
    }
  }

  function nowMsSyncedForRaffle() {
    return Date.now() + raffleServerTimeSkewMs;
  }

  /** Оставшееся время брони (мс): сначала монотонный отсчёт от серверного снимка, иначе reserved_until − синхронизированное «сейчас». */
  function getRaffleReservationLeftMs(untilTsFallback) {
    if (raffleReserveMonotonic.budgetMs != null && raffleReserveMonotonic.anchorPerf != null) {
      return Math.max(
        0,
        raffleReserveMonotonic.budgetMs - (performance.now() - raffleReserveMonotonic.anchorPerf),
      );
    }
    return Math.max(0, Number(untilTsFallback || 0) - nowMsSyncedForRaffle());
  }

  /** @type {{ elPrefix: string, raffle: Record<string, unknown> | null, rangeFrom: number, rangeTo: number, selected: Set<number>, order: Record<string, unknown> | null, orderNumbers: number[], timerId: ReturnType<typeof setInterval> | null, sberMethod: "collection" | "qr" | null, currentPayStep: string | null, onlyFreeView: boolean, lastCells: Array<{n:number,kind:string}>, rangeParts: Array<{from:number,to:number}> }} */
  var raffleDetailState = {
    elPrefix: "raffle-page",
    raffle: null,
    rangeFrom: 1,
    rangeTo: 500,
    selected: new Set(),
    order: null,
    orderNumbers: [],
    timerId: null,
    sberMethod: null,
    currentPayStep: null,
    onlyFreeView: false,
    lastCells: [],
    rangeParts: [],
  };

  function clearRaffleDetailTimer() {
    if (raffleDetailState.timerId) {
      clearInterval(raffleDetailState.timerId);
      raffleDetailState.timerId = null;
    }
  }

  function resetRaffleDetailSelection() {
    raffleDetailState.selected.clear();
    raffleDraftHydrated = false;
  }

  function getRaffleDraftStorageKey(raffleId) {
    return "ab_raffle_draft_" + String(raffleId);
  }

  function loadRaffleDraftSelection(raffleId) {
    if (!Number.isFinite(raffleId) || raffleId < 1) return [];
    try {
      var raw = localStorage.getItem(getRaffleDraftStorageKey(raffleId));
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .map(function (x) {
          return Number(x);
        })
        .filter(function (x) {
          return Number.isFinite(x) && x > 0;
        });
    } catch (_) {
      return [];
    }
  }

  function persistRaffleDraftSelection() {
    if (!IS_RAFFLE_PURCHASE_PAGE || !raffleDetailState.raffle || !raffleDetailState.raffle.id) return;
    var raffleId = Number(raffleDetailState.raffle.id);
    if (!Number.isFinite(raffleId) || raffleId < 1) return;
    try {
      var nums = Array.from(raffleDetailState.selected || []).sort(function (a, b) {
        return a - b;
      });
      if (!nums.length) {
        localStorage.removeItem(getRaffleDraftStorageKey(raffleId));
        return;
      }
      localStorage.setItem(getRaffleDraftStorageKey(raffleId), JSON.stringify(nums));
    } catch (_) {}
  }

  function restoreRaffleDraftSelectionFromStorage() {
    if (!IS_RAFFLE_PURCHASE_PAGE || !raffleDetailState.raffle || !raffleDetailState.raffle.id) return;
    var raffleId = Number(raffleDetailState.raffle.id);
    if (!Number.isFinite(raffleId) || raffleId < 1) return;
    var fromStorage = loadRaffleDraftSelection(raffleId);
    for (var i = 0; i < fromStorage.length; i++) {
      if (raffleDetailState.selected.size >= RAFFLE_MAX_SELECT) break;
      raffleDetailState.selected.add(fromStorage[i]);
    }
  }

  async function flushRaffleSelectionSync() {
    if (!IS_RAFFLE_PURCHASE_PAGE || !raffleDetailState.raffle || !raffleDetailState.raffle.id) return;
    if (raffleSelectionSyncInFlight) {
      raffleSelectionSyncQueued = true;
      return;
    }
    raffleSelectionSyncInFlight = true;
    raffleSelectionSyncQueued = false;
    try {
      var shouldReloadGrid = false;
      var desired = Array.from(raffleDetailState.selected || []).sort(function (a, b) {
        return a - b;
      });
      var order = raffleDetailState.order;
      var isReservedOrder = !!(order && String(order.status || "") === "reserved" && Number(order.id) > 0);
      var current = Array.isArray(raffleDetailState.orderNumbers) ? raffleDetailState.orderNumbers.slice() : [];

      if (isReservedOrder) {
        var currentSet = new Set(current);
        var desiredSet = new Set(desired);
        var toAdd = desired.filter(function (n) {
          return !currentSet.has(n);
        });
        var toRemove = current.filter(function (n) {
          return !desiredSet.has(n);
        });

        if (toAdd.length) {
          shouldReloadGrid = true;
          var added = await apiJson("/api/raffles/orders/" + String(order.id) + "/add-tickets", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ numbers: toAdd }),
          });
          applyRaffleServerTimeSkewFromPayload(added);
          raffleDetailState.order = added && added.order ? added.order : raffleDetailState.order;
          raffleDetailState.orderNumbers = added && Array.isArray(added.numbers) ? added.numbers : [];
          current = raffleDetailState.orderNumbers.slice();
          currentSet = new Set(current);
        }
        for (var i = 0; i < toRemove.length; i++) {
          shouldReloadGrid = true;
          var removed = await apiJson(
            "/api/raffles/orders/" + String(order.id) + "/tickets/" + String(toRemove[i]),
            { method: "DELETE", headers: authHeaders() },
          );
          applyRaffleServerTimeSkewFromPayload(removed);
          raffleDetailState.order = removed && removed.order ? removed.order : null;
          raffleDetailState.orderNumbers = removed && Array.isArray(removed.numbers) ? removed.numbers : [];
        }
      }
      persistRaffleDraftSelection();
      fetchCartFromApi()
        .then(function () {
          if (modalCart && modalCart.classList.contains("is-open")) {
            renderCartModalBody(raffleDataCache.cart ? raffleDataCache.cart.items : []);
          }
        })
        .catch(function () {});
      if (shouldReloadGrid) {
        loadRaffleTicketSlice().catch(function () {});
      }
    } catch (_) {
      // keep UI instant; API sync retries on next action
    } finally {
      raffleSelectionSyncInFlight = false;
      if (raffleSelectionSyncQueued) {
        raffleSelectionSyncQueued = false;
        flushRaffleSelectionSync().catch(function () {});
      }
    }
  }

  function scheduleRaffleSelectionSync() {
    if (!IS_RAFFLE_PURCHASE_PAGE) return;
    persistRaffleDraftSelection();
    if (raffleSelectionSyncTimer) clearTimeout(raffleSelectionSyncTimer);
    raffleSelectionSyncTimer = setTimeout(function () {
      flushRaffleSelectionSync().catch(function () {});
    }, 220);
  }

  function closeRaffleUnavailableModal() {
    closeModal(modalRaffleUnavailable);
  }

  function closeCartModal() {
    setCartCheckoutLoading(false);
    if (modalCart) closeModal(modalCart);
  }

  var ticketsLookupTimers = Object.create(null);
  var TICKETS_GUIDE_DISMISS_KEY = "ab_tickets_guide_dismissed_v1";
  var HOME_RELOAD_ONCE_KEY = "ab_home_reload_once_v1";

  function markNeedHomeReloadOnce() {
    try {
      sessionStorage.setItem(HOME_RELOAD_ONCE_KEY, "1");
    } catch (_) {}
  }

  function consumeNeedHomeReloadOnce() {
    try {
      if (sessionStorage.getItem(HOME_RELOAD_ONCE_KEY) !== "1") return false;
      sessionStorage.removeItem(HOME_RELOAD_ONCE_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  function closeTicketsModal() {
    if (modalTickets) closeModal(modalTickets);
  }

  function getTicketSearchSlotsLeft() {
    if (!IS_RAFFLE_PURCHASE_PAGE || !raffleDetailState.raffle) return 0;
    return Math.max(0, RAFFLE_MAX_SELECT - raffleDetailState.selected.size);
  }

  function randomTicketsPhrase(n) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return "случайных билетов";
    if (mod10 === 1) return "случайный билет";
    if (mod10 >= 2 && mod10 <= 4) return "случайных билета";
    return "случайных билетов";
  }

  function clampTicketSearchRandomQty() {
    var max = getTicketSearchSlotsLeft();
    if (max < 1) {
      ticketSearchRandomQty = 1;
      return;
    }
    if (ticketSearchRandomQty > max) ticketSearchRandomQty = max;
    if (ticketSearchRandomQty < 1) ticketSearchRandomQty = 1;
  }

  function updateTicketSearchRandomPanel() {
    var disp = document.getElementById("ticket-search-random-qty-display");
    var btn = document.getElementById("ticket-search-random-apply");
    var minus = document.getElementById("ticket-search-random-minus");
    var plus = document.getElementById("ticket-search-random-plus");
    clampTicketSearchRandomQty();
    var max = getTicketSearchSlotsLeft();
    if (disp) disp.textContent = String(ticketSearchRandomQty);
    document.querySelectorAll("[data-random-preset]").forEach(function (b) {
      var v = Number(b.getAttribute("data-random-preset"));
      b.classList.toggle("ticket-search-random__preset--active", v === ticketSearchRandomQty);
    });
    var phrase = "Добавить " + String(ticketSearchRandomQty) + " " + randomTicketsPhrase(ticketSearchRandomQty);
    if (btn) btn.textContent = phrase;
    var can =
      max >= 1 &&
      ticketSearchRandomQty <= max &&
      IS_RAFFLE_PURCHASE_PAGE &&
      !raffleDetailState.order &&
      !!(raffleDetailState.raffle && raffleDetailState.raffle.id);
    if (btn) btn.disabled = !can;
    if (minus) minus.disabled = ticketSearchRandomQty <= 1 || max < 1;
    if (plus) plus.disabled = ticketSearchRandomQty >= max || max < 1;
  }

  function resetTicketSearchSheet() {
    ticketSearchLastLookup = { n: NaN, kind: null };
    ticketSearchRandomQty = 5;
    if (ticketSearchLookupTimer) {
      clearTimeout(ticketSearchLookupTimer);
      ticketSearchLookupTimer = null;
    }
    var inp = document.getElementById("ticket-search-input");
    var apply = document.getElementById("ticket-search-apply");
    var field = document.getElementById("ticket-search-field");
    var badge = document.getElementById("ticket-search-status-badge");
    var mEnter = document.getElementById("ticket-search-mode-enter");
    var mRand = document.getElementById("ticket-search-mode-random");
    var pEnter = document.getElementById("ticket-search-panel-enter");
    var pRand = document.getElementById("ticket-search-panel-random");
    if (inp) inp.value = "";
    if (field) field.className = "ticket-search-sheet__field";
    if (badge) {
      badge.className = "ticket-search-status-badge ticket-search-status-badge--empty";
      badge.textContent = "";
    }
    if (apply) {
      apply.disabled = true;
      apply.textContent = "Укажите свободный номер";
      apply.className = "btn btn--primary ticket-search-sheet__cta";
    }
    if (mEnter && mRand) {
      mEnter.classList.add("ticket-search-sheet__seg--active");
      mRand.classList.remove("ticket-search-sheet__seg--active");
      mEnter.setAttribute("aria-selected", "true");
      mRand.setAttribute("aria-selected", "false");
    }
    if (pEnter && pRand) {
      pEnter.hidden = false;
      pRand.hidden = true;
    }
    document.querySelectorAll("[data-random-preset]").forEach(function (b) {
      var v = Number(b.getAttribute("data-random-preset"));
      b.classList.toggle("ticket-search-random__preset--active", v === 5);
    });
    updateTicketSearchRandomPanel();
    updateTicketSearchApplyUI();
    renderTicketSearchPickedFooter();
  }

  function renderTicketSearchPickedFooter() {
    var wrap = document.getElementById("ticket-search-picked");
    var chips = document.getElementById("ticket-search-picked-chips");
    var goCart = document.getElementById("ticket-search-go-cart");
    if (!wrap || !chips || !goCart) return;
    if (!IS_RAFFLE_PURCHASE_PAGE || raffleDetailState.order) {
      wrap.hidden = true;
      chips.innerHTML = "";
      goCart.textContent = "Перейти в корзину";
      return;
    }
    var nums = Array.from(raffleDetailState.selected || []).sort(function (a, b) {
      return a - b;
    });
    if (!nums.length) {
      wrap.hidden = true;
      chips.innerHTML = "";
      goCart.textContent = "Перейти в корзину";
      return;
    }
    wrap.hidden = false;
    chips.innerHTML = nums
      .map(function (n) {
        return (
          '<button type="button" class="ticket-search-picked__chip" data-ticket-search-picked-remove="' +
          String(n) +
          '" aria-label="Убрать номер ' +
          escapeHtml(String(n)) +
          '">' +
          "№" +
          escapeHtml(String(n)) +
          ' <span aria-hidden="true">×</span></button>'
        );
      })
      .join("");
    goCart.textContent = "Перейти в корзину (" + String(nums.length) + ")";
  }

  function openTicketSearchModal() {
    if (!modalTicketSearch) return;
    var s = loadSession();
    if (!s || !s.token) {
      openModal(modalLogin);
      return;
    }
    if (!authVerified) return;
    if (isRaffleLockedByReceiptPending()) {
      openWaitReceiptModal();
      return;
    }
    if (!IS_RAFFLE_PURCHASE_PAGE) {
      showToast("Поиск номера доступен на странице выбора номерков в акции.", "info");
      return;
    }
    if (raffleDetailState.order) {
      showToast("Поиск недоступен на этом шаге.", "warning");
      return;
    }
    closeChatPanel();
    closeCartModal();
    closeTicketsModal();
    if (modalProfile) closeModal(modalProfile);
    resetTicketSearchSheet();
    renderTicketSearchPickedFooter();
    openModal(modalTicketSearch);
    setBottomNavActive();
  }

  function closeTicketSearchModal() {
    if (modalTicketSearch) closeModal(modalTicketSearch);
  }

  function formatMmSs(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function formatReserveDeadlineMoscow(ms) {
    try {
      var d = new Date(Number(ms));
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "";
    }
  }

  function stopReservePaymentTimer() {
    if (reservePaymentTimerId) {
      clearInterval(reservePaymentTimerId);
      reservePaymentTimerId = null;
    }
  }

  function stopWaitReceiptModalTimer() {
    if (waitReceiptModalTimerId) {
      clearInterval(waitReceiptModalTimerId);
      waitReceiptModalTimerId = null;
    }
  }

  function startWaitReceiptModalTimer(untilTs) {
    stopWaitReceiptModalTimer();
    function paintWaitRec() {
      var leftEl = document.getElementById("wait-receipt-left");
      var deadEl = document.getElementById("wait-receipt-deadline");
      var left = getRaffleReservationLeftMs(untilTs);
      if (leftEl) leftEl.textContent = left <= 0 ? "Бронь истекла" : "Осталось " + formatMmSs(left);
      if (deadEl) {
        var dl = formatReserveDeadlineMoscow(Number(untilTs || 0));
        deadEl.textContent = dl ? "Крайний срок (МСК): " + dl : "";
      }
    }
    paintWaitRec();
    waitReceiptModalTimerId = setInterval(paintWaitRec, 1000);
  }

  function scheduleReservationReminder(untilTs) {
    if (reservationReminderTimerId) {
      clearTimeout(reservationReminderTimerId);
      reservationReminderTimerId = null;
    }
    var remindBeforeMs = 5 * 60 * 1000;
    var delay = getRaffleReservationLeftMs(untilTs) - remindBeforeMs;
    if (!Number.isFinite(delay) || delay < 1000) return;
    reservationReminderTimerId = setTimeout(function () {
      showToast("До конца брони осталось около 5 минут", "warning");
      try {
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Бронь скоро истечет", {
            body: "Осталось около 5 минут. Завершите оплату и отправьте чек.",
          });
        }
      } catch (_) {}
      reservationReminderTimerId = null;
    }, delay);
  }

  /**
   * @param {"success" | "requisites" | "confirm" | "wait"} phase
   */
  function paintPaymentFlowSteps(navId, phase) {
    var nav = document.getElementById(navId);
    if (!nav) return;
    var steps = nav.querySelectorAll(".payment-flow-steps__step");
    var current = 2;
    if (phase === "success") current = 1;
    else if (phase === "requisites") current = 2;
    else if (phase === "confirm" || phase === "wait") current = 3;
    steps.forEach(function (li, i) {
      var n = i + 1;
      li.classList.remove("is-done", "is-current", "is-upcoming");
      if (n < current) li.classList.add("is-done");
      else if (n === current) li.classList.add("is-current");
      else li.classList.add("is-upcoming");
    });
  }

  function paintRaffleRulesLinks(url) {
    var u = String(url || "").trim();
    var pairs = [
      ["reserve-payment-rules-wrap", "reserve-payment-rules-link"],
      ["wait-receipt-rules-wrap", "wait-receipt-rules-link"],
    ];
    for (var pi = 0; pi < pairs.length; pi++) {
      var w = document.getElementById(pairs[pi][0]);
      var a = document.getElementById(pairs[pi][1]);
      if (!w || !a) continue;
      if (u) {
        w.hidden = false;
        a.setAttribute("href", u);
      } else {
        w.hidden = true;
        a.setAttribute("href", "#");
      }
    }
  }

  function switchReservePaymentStep(step) {
    var title = document.getElementById("reserve-payment-title");
    var backBtn = document.getElementById("reserve-payment-back");
    var req = document.getElementById("reserve-payment-step-requisites");
    var conf = document.getElementById("reserve-payment-step-confirm");
    var hint = document.getElementById("reserve-payment-phase-hint");
    var isConfirm = step === "confirm";
    if (req) req.hidden = isConfirm;
    if (conf) conf.hidden = !isConfirm;
    if (backBtn) backBtn.hidden = !isConfirm;
    if (title) title.textContent = isConfirm ? "Чек по переводу" : "Оплата по реквизитам";
    if (hint) {
      hint.textContent = isConfirm
        ? "Шаг 3 из 3: прикрепите чек (фото или PDF). После отправки заявка уйдёт на проверку."
        : "Шаг 2 из 3: переведите сумму снизу, затем нажмите «Я перевёл — загрузить чек».";
    }
    paintPaymentFlowSteps("reserve-payment-steps", isConfirm ? "confirm" : "requisites");
  }

  function paintReserveDeadlineLine(untilTs) {
    var dl = formatReserveDeadlineMoscow(untilTs);
    var text = dl ? "Крайний срок брони (МСК): " + dl : "";
    var a = document.getElementById("reserve-success-deadline");
    var b = document.getElementById("reserve-payment-deadline");
    if (a) a.textContent = text;
    if (b) b.textContent = text;
  }

  function renderReserveFlowModals() {
    var nums = Array.isArray(reserveFlowState.numbers) ? reserveFlowState.numbers : [];
    var amountText = formatRubleAmount(Number(reserveFlowState.amountRub || 0)) + " ₽";
    var orderCode = reserveFlowState.orderId ? "A" + String(reserveFlowState.orderId) : "—";

    var successOrderId = document.getElementById("reserve-success-order-id");
    var successPicked = document.getElementById("reserve-success-picked-label");
    var successNumbers = document.getElementById("reserve-success-numbers");
    var successAmount = document.getElementById("reserve-success-amount");
    if (successOrderId) successOrderId.textContent = orderCode;
    if (successPicked) successPicked.textContent = "Выбрано (" + String(nums.length) + ")";
    if (successAmount) successAmount.textContent = amountText;
    if (successNumbers) {
      successNumbers.innerHTML = nums
        .map(function (n) {
          return '<span class="reserve-success-modal__chip">' + escapeHtml(String(n)) + "</span>";
        })
        .join("");
    }

    var payOrderId = document.getElementById("reserve-payment-order-id");
    var payAmount = document.getElementById("reserve-payment-amount");
    var payAmountInline = document.getElementById("reserve-payment-amount-inline");
    var payAmountCheck = document.getElementById("reserve-payment-amount-check");
    var payRecipient = document.getElementById("reserve-payment-recipient");
    var payRecipientTbank = document.getElementById("reserve-payment-recipient-tbank");
    var payQrRecipient = document.getElementById("reserve-payment-qr-recipient");
    var payLink = document.getElementById("reserve-payment-link");
    var payLinkTbank = document.getElementById("reserve-payment-link-tbank");
    var payQrImg = document.getElementById("reserve-payment-qr-image");
    var payPurpose = document.getElementById("reserve-payment-purpose");
    var payPurposeTbank = document.getElementById("reserve-payment-purpose-tbank");
    var payQrPurpose = document.getElementById("reserve-payment-qr-purpose");
    var payQrPurposeHint = document.getElementById("reserve-payment-qr-purpose-hint");
    var methodTabs = document.getElementById("reserve-payment-methods");
    var methodCollectionBtn = document.getElementById("reserve-payment-method-collection");
    var methodTbankBtn = document.getElementById("reserve-payment-method-tbank");
    var methodQrBtn = document.getElementById("reserve-payment-method-qr");
    var collectBlock = document.getElementById("reserve-payment-collect");
    var collectTbankBlock = document.getElementById("reserve-payment-collect-tbank");
    var qrBlock = document.getElementById("reserve-payment-qr");
    var methodsAvailable = 0;
    var hasCollection =
      Boolean(reserveFlowState.sberEnabled) && Boolean(String(reserveFlowState.collectionUrl || "").trim());
    var hasTbankCollection =
      Boolean(reserveFlowState.tbankEnabled) &&
      Boolean(String(reserveFlowState.tbankCollectionUrl || "").trim());
    var hasQr = Boolean(reserveFlowState.qrEnabled) && Boolean(String(reserveFlowState.qrImageUrl || "").trim());
    if (hasCollection) methodsAvailable += 1;
    if (hasTbankCollection) methodsAvailable += 1;
    if (hasQr) methodsAvailable += 1;
    var chosenMethod = String(reserveFlowState.paymentMethod || "collection");
    if (chosenMethod === "collection" && !hasCollection) {
      chosenMethod = hasTbankCollection ? "tbank_collection" : hasQr ? "qr" : "collection";
    } else if (chosenMethod === "tbank_collection" && !hasTbankCollection) {
      chosenMethod = hasCollection ? "collection" : hasQr ? "qr" : "tbank_collection";
    } else if (chosenMethod === "qr" && !hasQr) {
      chosenMethod = hasCollection ? "collection" : hasTbankCollection ? "tbank_collection" : "qr";
    }
    reserveFlowState.paymentMethod = chosenMethod;
    if (payOrderId) payOrderId.textContent = orderCode;
    if (payAmount) payAmount.textContent = amountText;
    if (payAmountInline) payAmountInline.textContent = amountText;
    if (payAmountCheck) payAmountCheck.textContent = amountText;
    var purposeText = String(reserveFlowState.qrPaymentPurpose || "Оплата услуг").trim() || "Оплата услуг";
    if (payPurpose) payPurpose.textContent = purposeText;
    if (payPurposeTbank) payPurposeTbank.textContent = purposeText;
    if (payQrPurpose) payQrPurpose.textContent = purposeText;
    if (payQrPurposeHint) payQrPurposeHint.textContent = "«" + purposeText + "»";
    if (payRecipient)
      payRecipient.textContent = reserveFlowState.sberCollectionRecipient || "Реквизиты уточняются";
    if (payRecipientTbank)
      payRecipientTbank.textContent = reserveFlowState.tbankCollectionRecipient || "Реквизиты уточняются";
    if (payQrRecipient) payQrRecipient.textContent = reserveFlowState.qrRecipient || "Реквизиты уточняются";
    if (payLink) {
      var href = String(reserveFlowState.collectionUrl || "").trim();
      payLink.href = href || "#";
      payLink.setAttribute("aria-disabled", href ? "false" : "true");
      payLink.classList.toggle("reserve-flow-btn--disabled", !href);
    }
    if (payLinkTbank) {
      var tbankHref = String(reserveFlowState.tbankCollectionUrl || "").trim();
      payLinkTbank.href = tbankHref || "#";
      payLinkTbank.setAttribute("aria-disabled", tbankHref ? "false" : "true");
      payLinkTbank.classList.toggle("reserve-flow-btn--disabled", !tbankHref);
    }
    if (payQrImg) {
      var qrSrc = String(reserveFlowState.qrImageUrl || "").trim();
      if (qrSrc) payQrImg.setAttribute("src", qrSrc);
      else payQrImg.removeAttribute("src");
    }
    if (methodTabs) methodTabs.hidden = methodsAvailable < 2;
    if (methodCollectionBtn) {
      methodCollectionBtn.hidden = !hasCollection;
      methodCollectionBtn.classList.toggle("is-active", chosenMethod === "collection");
      methodCollectionBtn.setAttribute("aria-selected", chosenMethod === "collection" ? "true" : "false");
    }
    if (methodTbankBtn) {
      methodTbankBtn.hidden = !hasTbankCollection;
      methodTbankBtn.classList.toggle("is-active", chosenMethod === "tbank_collection");
      methodTbankBtn.setAttribute("aria-selected", chosenMethod === "tbank_collection" ? "true" : "false");
    }
    if (methodQrBtn) {
      methodQrBtn.hidden = !hasQr;
      methodQrBtn.classList.toggle("is-active", chosenMethod === "qr");
      methodQrBtn.setAttribute("aria-selected", chosenMethod === "qr" ? "true" : "false");
    }
    if (collectBlock) collectBlock.hidden = chosenMethod !== "collection";
    if (collectTbankBlock) collectTbankBlock.hidden = chosenMethod !== "tbank_collection";
    if (qrBlock) qrBlock.hidden = chosenMethod !== "qr";
    switchReservePaymentStep("requisites");
    paintReserveDeadlineLine(Number(reserveFlowState.reservedUntil || 0));
    var rf = getCachedRaffleById(reserveFlowState.raffleId);
    var rulesUrl = String((rf && rf.rules_url) || "").trim();
    if (
      !rulesUrl &&
      raffleDetailState.raffle &&
      Number(raffleDetailState.raffle.id) === Number(reserveFlowState.raffleId)
    ) {
      rulesUrl = String(raffleDetailState.raffle.rules_url || "").trim();
    }
    paintRaffleRulesLinks(rulesUrl);
  }

  function startReservePaymentTimer(untilTs) {
    stopReservePaymentTimer();
    scheduleReservationReminder(untilTs);
    var timerEl = document.getElementById("reserve-payment-timer");
    var fillEl = document.getElementById("reserve-payment-progress");
    var denomMs = Math.max(60_000, getRaffleReservationLeftMs(untilTs));
    function paint() {
      var left = getRaffleReservationLeftMs(untilTs);
      if (timerEl) timerEl.textContent = formatMmSs(left);
      if (fillEl) {
        var pct = Math.max(0, Math.min(100, denomMs > 0 ? (left / denomMs) * 100 : 0));
        fillEl.style.width = pct + "%";
      }
      if (left <= 0) {
        openReserveExpiredModal();
      }
    }
    paint();
    reservePaymentTimerId = setInterval(paint, 1000);
  }

  function closeReservePaymentModal() {
    stopReservePaymentTimer();
    switchReservePaymentStep("requisites");
    var input = document.getElementById("reserve-payment-file");
    if (input) input.value = "";
    var nameEl = document.getElementById("reserve-payment-file-name");
    if (nameEl) nameEl.textContent = "Фото или PDF перевода";
    if (modalReservePayment) closeModal(modalReservePayment);
  }

  function openReserveExpiredModal() {
    stopReservePaymentTimer();
    if (modalReserveSuccess) closeModal(modalReserveSuccess);
    if (modalReservePayment) closeModal(modalReservePayment);
    if (modalWaitReceipt) closeModal(modalWaitReceipt);
    raffleDetailState.order = null;
    raffleDetailState.orderNumbers = [];
    clearRaffleReservationCountdownAnchor();
    if (IS_RAFFLE_PURCHASE_PAGE) {
      loadRaffleTicketSlice().catch(function () {});
    }
    fetchCartFromApi().catch(function () {});
    fetchTicketsFromApi().catch(function () {});
    loadRafflesFeed().catch(function () {});
    if (modalReserveExpired) openModal(modalReserveExpired);
  }

  function getCachedRaffleById(raffleId) {
    for (var i = 0; i < raffleDetailCache.length; i++) {
      if (Number(raffleDetailCache[i] && raffleDetailCache[i].id) === Number(raffleId)) {
        return raffleDetailCache[i];
      }
    }
    return IS_RAFFLE_PURCHASE_PAGE &&
      raffleDetailState.raffle &&
      Number(raffleDetailState.raffle.id) === Number(raffleId)
      ? raffleDetailState.raffle
      : null;
  }

  function openReserveSuccessFlow(order, numbers, raffle) {
    if (!order) return;
    reserveFlowState.orderId = Number(order.id) || 0;
    reserveFlowState.raffleId = Number(order.raffle_id || (raffle && raffle.id) || 0) || 0;
    reserveFlowState.numbers = Array.isArray(numbers) ? numbers.slice().sort(function (a, b) { return a - b; }) : [];
    reserveFlowState.amountRub = Number(order.amount_rub || 0);
    reserveFlowState.reservedUntil = Number(order.reserved_until || 0);
    reserveFlowState.collectionUrl = String((raffle && raffle.collection_url) || "").trim();
    reserveFlowState.tbankCollectionUrl = String((raffle && raffle.tbank_collection_url) || "").trim();
    reserveFlowState.sberCollectionRecipient = String(
      (raffle && (raffle.sber_collection_recipient || raffle.collection_recipient)) || "",
    ).trim();
    reserveFlowState.tbankCollectionRecipient = String(
      (raffle && (raffle.tbank_collection_recipient || raffle.collection_recipient)) || "",
    ).trim();
    reserveFlowState.qrImageUrl = String((raffle && raffle.qr_image_url) || "").trim();
    reserveFlowState.qrRecipient = String(
      (raffle && (raffle.qr_recipient || raffle.collection_recipient)) || "",
    ).trim();
    reserveFlowState.qrPaymentPurpose = String(
      (raffle && raffle.qr_payment_purpose) || "Оплата услуг",
    )
      .trim()
      .slice(0, 200);
    reserveFlowState.sberEnabled =
      raffle && raffle.sber_enabled != null
        ? !!raffle.sber_enabled
        : Boolean(String((raffle && raffle.collection_url) || "").trim());
    reserveFlowState.tbankEnabled =
      raffle && raffle.tbank_enabled != null
        ? !!raffle.tbank_enabled
        : Boolean(String((raffle && raffle.tbank_collection_url) || "").trim());
    reserveFlowState.qrEnabled =
      raffle && raffle.qr_enabled != null
        ? !!raffle.qr_enabled
        : Boolean(String((raffle && raffle.qr_image_url) || "").trim());
    reserveFlowState.paymentMethod = "collection";
    renderReserveFlowModals();
    paintPaymentFlowSteps("reserve-success-steps", "success");
    emitUxEvent("raffle_reserved", { order_id: reserveFlowState.orderId, tickets: reserveFlowState.numbers.length });
    if (modalReserveSuccess) openModal(modalReserveSuccess);
  }

  function isRaffleLockedByReceiptPending() {
    var o = raffleDetailState.order;
    return !!(o && String(o.status || "") === "reserved" && Number(o.id) > 0);
  }

  function openWaitReceiptModal() {
    if (!IS_RAFFLE_PURCHASE_PAGE) return;
    if (!isRaffleLockedByReceiptPending()) return;
    var r = raffleDetailState.raffle;
    var rid = r && r.id != null ? Number(r.id) : 0;
    function paintAndOpen() {
      if (!isRaffleLockedByReceiptPending()) {
        fetchCartFromApi().catch(function () {});
        fetchTicketsFromApi().catch(function () {});
        loadRaffleTicketSlice().catch(function () {});
        return;
      }
      var o = raffleDetailState.order;
      var rf = raffleDetailState.raffle;
      reserveFlowState.orderId = Number(o && o.id) || 0;
      reserveFlowState.raffleId = Number((o && o.raffle_id) || (rf && rf.id) || 0) || 0;
      reserveFlowState.numbers = Array.isArray(raffleDetailState.orderNumbers)
        ? raffleDetailState.orderNumbers.slice().sort(function (a, b) {
            return a - b;
          })
        : [];
      reserveFlowState.amountRub = Number((o && o.amount_rub) || 0);
      reserveFlowState.reservedUntil = Number((o && o.reserved_until) || 0);
      reserveFlowState.collectionUrl = String((rf && rf.collection_url) || "").trim();
      reserveFlowState.tbankCollectionUrl = String((rf && rf.tbank_collection_url) || "").trim();
      reserveFlowState.sberCollectionRecipient = String(
        (rf && (rf.sber_collection_recipient || rf.collection_recipient)) || "",
      ).trim();
      reserveFlowState.tbankCollectionRecipient = String(
        (rf && (rf.tbank_collection_recipient || rf.collection_recipient)) || "",
      ).trim();
      reserveFlowState.qrImageUrl = String((rf && rf.qr_image_url) || "").trim();
      reserveFlowState.qrRecipient = String(
        (rf && (rf.qr_recipient || rf.collection_recipient)) || "",
      ).trim();
      reserveFlowState.qrPaymentPurpose = String((rf && rf.qr_payment_purpose) || "Оплата услуг")
        .trim()
        .slice(0, 200);
      reserveFlowState.sberEnabled =
        rf && rf.sber_enabled != null
          ? !!rf.sber_enabled
          : Boolean(String((rf && rf.collection_url) || "").trim());
      reserveFlowState.tbankEnabled =
        rf && rf.tbank_enabled != null
          ? !!rf.tbank_enabled
          : Boolean(String((rf && rf.tbank_collection_url) || "").trim());
      reserveFlowState.qrEnabled =
        rf && rf.qr_enabled != null
          ? !!rf.qr_enabled
          : Boolean(String((rf && rf.qr_image_url) || "").trim());
      reserveFlowState.paymentMethod =
        reserveFlowState.paymentMethod === "qr" || reserveFlowState.paymentMethod === "tbank_collection"
          ? reserveFlowState.paymentMethod
          : "collection";
      renderReserveFlowModals();
      var amountEl = document.getElementById("wait-receipt-amount");
      var leftEl = document.getElementById("wait-receipt-left");
      if (amountEl) amountEl.textContent = formatRubleAmount(reserveFlowState.amountRub) + " ₽";
      if (leftEl) {
        var leftMs = getRaffleReservationLeftMs(reserveFlowState.reservedUntil);
        leftEl.textContent = leftMs <= 0 ? "Бронь истекла" : "Осталось " + formatMmSs(leftMs);
      }
      var wDead = document.getElementById("wait-receipt-deadline");
      if (wDead) {
        var wdl = formatReserveDeadlineMoscow(reserveFlowState.reservedUntil);
        wDead.textContent = wdl ? "Крайний срок (МСК): " + wdl : "";
      }
      paintPaymentFlowSteps("wait-receipt-steps", "wait");
      if (modalWaitReceipt) openModal(modalWaitReceipt);
      startWaitReceiptModalTimer(reserveFlowState.reservedUntil);
    }
    if (Number.isFinite(rid) && rid > 0) {
      fetch("/api/raffles/" + String(rid) + "/order", {
        cache: "no-store",
        headers: authHeaders(),
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d: d };
          });
        })
        .then(function (x) {
          if (x.ok && x.d) {
            applyRaffleServerTimeSkewFromPayload(x.d);
            raffleDetailState.order = x.d.order || null;
            raffleDetailState.orderNumbers = Array.isArray(x.d.numbers) ? x.d.numbers : [];
            if (!raffleDetailState.order || String(raffleDetailState.order.status || "") !== "reserved") {
              clearRaffleReservationCountdownAnchor();
            }
          }
          paintAndOpen();
        })
        .catch(function () {
          paintAndOpen();
        });
    } else {
      paintAndOpen();
    }
  }

  function formatReserveUntilMs(ms) {
    return formatReserveDeadlineMoscow(ms);
  }

  function countTicketsInActiveRaffles(tickets) {
    if (!tickets) return 0;
    var n = 0;
    function add(arr) {
      (arr || []).forEach(function (it) {
        var st = it.raffle && it.raffle.status;
        if (st === "active") {
          n += (it.numbers && it.numbers.length) || 0;
        }
      });
    }
    add(tickets.reserved);
    add(tickets.pending_review);
    add(tickets.confirmed);
    return n;
  }

  function syncTicketsNavBadge() {
    var tab = document.getElementById("tab-tickets");
    var badge = document.getElementById("tickets-nav-badge");
    if (!tab || !badge) return;
    var s = loadSession();
    if (!s || !s.token || !authVerified || !raffleDataCache.tickets) {
      badge.hidden = true;
      badge.textContent = "";
      tab.classList.remove("bottom-nav-btn--tickets-has-items");
      return;
    }
    var n = countTicketsInActiveRaffles(raffleDataCache.tickets);
    if (n > 0) {
      badge.hidden = false;
      badge.textContent = n > 99 ? "99+" : String(n);
      tab.classList.add("bottom-nav-btn--tickets-has-items");
    } else {
      badge.hidden = true;
      badge.textContent = "";
      tab.classList.remove("bottom-nav-btn--tickets-has-items");
    }
  }

  function syncProfileTicketCount() {
    var el = document.getElementById("profile-stat-tickets");
    if (!el) return;
    var s = loadSession();
    if (!s || !s.token || !authVerified) {
      el.textContent = "0";
      return;
    }
    if (raffleDataCache.tickets) {
      var n = 0;
      (raffleDataCache.tickets.confirmed || []).forEach(function (it) {
        var st = it.raffle && it.raffle.status;
        if (st === "active") {
          n += (it.numbers && it.numbers.length) || 0;
        }
      });
      el.textContent = String(n);
      return;
    }
    fetch("/api/raffles/my-tickets", { cache: "no-store", headers: authHeaders() })
      .then(function (res) {
        return res.json().then(function (d) {
          return { ok: res.ok, d: d };
        });
      })
      .then(function (x) {
        if (!x.ok) throw new Error();
        var n = 0;
        (x.d.confirmed || []).forEach(function (it) {
          var st = it.raffle && it.raffle.status;
          if (st === "active") {
            n += (it.numbers && it.numbers.length) || 0;
          }
        });
        el.textContent = String(n);
      })
      .catch(function () {
        el.textContent = "—";
      });
  }

  function ticketsEmptyAllHtml() {
    return (
      '<div class="tickets-empty">' +
      '<div class="tickets-empty__icon-wrap">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"></path>' +
      '<path d="M13 5v2"></path><path d="M13 17v2"></path><path d="M13 11v2"></path>' +
      "</svg></div>" +
      '<h4 class="tickets-empty__title">Нет билетов</h4>' +
      '<p class="tickets-empty__text">Выберите номерки на главном экране</p></div>'
    );
  }

  function ticketsEmptyReservedOnlyHtml() {
    return (
      '<div class="tickets-empty">' +
      '<h4 class="tickets-empty__title">Нет номерков в брони</h4>' +
      '<p class="tickets-empty__text">Забронируйте номерки в акции. Купленные билеты смотрите во вкладке «Купленные».</p></div>'
    );
  }

  function ticketsEmptyPendingHtml() {
    return (
      '<div class="tickets-empty">' +
      '<h4 class="tickets-empty__title">Нет номерков на проверке</h4>' +
      '<p class="tickets-empty__text">После отправки чека номерки появятся здесь до решения администратора.</p></div>'
    );
  }

  function ticketsEmptyConfirmedHtml() {
    return (
      '<div class="tickets-empty">' +
      '<h4 class="tickets-empty__title">Нет купленных билетов</h4>' +
      '<p class="tickets-empty__text">После оплаты и подтверждения по акциям они появятся здесь.</p></div>'
    );
  }

  function buildTicketsTimelineHtml(timeline) {
    if (!Array.isArray(timeline) || !timeline.length) return "";
    var html = '<div class="tickets-timeline"><p class="tickets-timeline__title">История заказа</p><ol class="tickets-timeline__list">';
    for (var ti = 0; ti < timeline.length; ti++) {
      var it = timeline[ti] || {};
      var at = Number(it.at);
      var timeStr = "";
      if (Number.isFinite(at) && at > 0) {
        try {
          timeStr = new Date(at).toLocaleString("ru-RU", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          });
        } catch (_) {
          timeStr = "";
        }
      }
      var det = it.detail
        ? '<span class="tickets-timeline__detail">' + escapeHtml(String(it.detail)) + "</span>"
        : "";
      html +=
        '<li class="tickets-timeline__item"><span class="tickets-timeline__label">' +
        escapeHtml(String(it.label || it.kind || "")) +
        '</span><span class="tickets-timeline__time">' +
        escapeHtml(timeStr) +
        "</span>" +
        det +
        "</li>";
    }
    html += "</ol></div>";
    return html;
  }

  function buildTrackingStatusLink(order) {
    var tok = order && order.tracking_token ? String(order.tracking_token).trim() : "";
    if (!tok) return "";
    var url =
      typeof location !== "undefined" && location.origin
        ? location.origin + "/home/order-status?t=" + encodeURIComponent(tok)
        : "/home/order-status?t=" + encodeURIComponent(tok);
    return (
      '<p class="tickets-group__track">' +
      '<a href="' +
      escapeHtml(url) +
      '" target="_blank" rel="noopener noreferrer" class="tickets-group__track-link">Статус заказа по ссылке</a></p>'
    );
  }

  function buildTicketsReservedHtml(reserved) {
    var html = "";
    var i;
    var j;
    var trophySvg =
      '<span class="tickets-reserved-head__icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21 2.18 1.09 3.02 2.58 3.02 4.34"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path></svg></span>';
    var clockSvg =
      '<svg class="tickets-reserved-status__icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';
    for (i = 0; i < reserved.length; i++) {
      var rv = reserved[i];
      var ro = rv.order || {};
      var oid = Number(ro.id);
      var title = escapeHtml(String((rv.raffle && rv.raffle.title) || ""));
      var nums = rv.numbers || [];
      var until = formatReserveUntilMs(ro.reserved_until);
      var meta = until ? "Снять бронь нужно до " + until + " (московское время)" : "Бронь активна";
      var orderCode = Number(ro.id) > 0 ? "A" + String(ro.id) : "—";
      var pendingCount = nums.length;
      html += '<section class="tickets-group tickets-group--reserved-pending">';
      html += '<div class="tickets-reserved-head">' + trophySvg + '<h3 class="tickets-reserved-head__title">' + title + "</h3></div>";
      html += '<hr class="tickets-reserved-divider" />';
      html += '<p class="tickets-reserved-meta">' + escapeHtml(meta) + "</p>";
      html += '<p class="tickets-group__meta">Заказ: <strong>' + escapeHtml(orderCode) + "</strong></p>";
      html += buildTrackingStatusLink(ro);
      html += buildTicketsTimelineHtml(rv.timeline);
      html += '<p class="tickets-reserved-status">' + clockSvg + "ожидают оплаты (" + String(pendingCount) + ")</p>";
      html += '<div class="tickets-chips tickets-chips--pending">';
      for (j = 0; j < nums.length; j++) {
        var nj = nums[j];
        html +=
          '<span class="tickets-chip">' +
          '<button type="button" class="tickets-chip__remove" data-tickets-remove="1" data-order-id="' +
          String(oid) +
          '" data-ticket="' +
          String(nj) +
          '" aria-label="Убрать номер ' +
          escapeHtml(String(nj)) +
          '">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          "</button>" +
          "№ " +
          escapeHtml(String(nj)) +
          "</span>";
      }
      html += "</div>";
      html +=
        '<div class="tickets-actions-row">' +
        '<button type="button" class="btn btn--secondary btn--sm btn--tickets-sm" data-tickets-attach="1" data-order-id="' +
        String(oid) +
        '" data-raffle-id="' +
        String(Number((rv.raffle && rv.raffle.id) || ro.raffle_id || 0) || 0) +
        '" data-amount-rub="' +
        String(Number(ro.amount_rub || 0) || 0) +
        '" data-reserved-until="' +
        String(Number(ro.reserved_until || 0) || 0) +
        '">Прикрепить чек</button>' +
        "</div>";
      html += "</section>";
    }
    return html;
  }

  function buildTicketsConfirmedHtml(confirmed) {
    var html = "";
    var i;
    var j;
    for (i = 0; i < confirmed.length; i++) {
      var cv = confirmed[i];
      var ctitle = escapeHtml(String((cv.raffle && cv.raffle.title) || ""));
      var cnums = cv.numbers || [];
      html += '<section class="tickets-group">';
      html += '<h3 class="tickets-group__title">' + ctitle + "</h3>";
      html += buildTicketsTimelineHtml(cv.timeline);
      html += '<div class="tickets-chips">';
      for (j = 0; j < cnums.length; j++) {
        var cj = cnums[j];
        html += '<span class="tickets-chip tickets-chip--readonly">№ ' + escapeHtml(String(cj)) + "</span>";
      }
      html += "</div></section>";
    }
    return html;
  }

  function buildTicketsWholesaleSectionHtml(wholesaleSlots, reserved, pending, confirmed) {
    if (!Array.isArray(wholesaleSlots) || !wholesaleSlots.length) return "";
    var titlesByRaffleId = Object.create(null);
    var groups = [reserved || [], pending || [], confirmed || []];
    for (var gi = 0; gi < groups.length; gi++) {
      var arr = groups[gi];
      for (var ai = 0; ai < arr.length; ai++) {
        var row = arr[ai] || {};
        var rr = row.raffle || {};
        var rid = Number(rr.id);
        if (!Number.isFinite(rid) || rid < 1) continue;
        if (!titlesByRaffleId[rid]) {
          titlesByRaffleId[rid] = String(rr.title || "").trim();
        }
      }
    }

    var html = "";
    var hasAny = false;
    for (var si = 0; si < wholesaleSlots.length; si++) {
      var slot = wholesaleSlots[si] || {};
      var rid2 = Number(slot.raffle_id);
      var nums = Array.isArray(slot.wholesale_numbers) ? slot.wholesale_numbers : [];
      if (!Number.isFinite(rid2) || rid2 < 1 || !nums.length) continue;
      hasAny = true;
      var whStr = nums
        .map(function (wn) {
          return "№ " + escapeHtml(String(wn));
        })
        .join(", ");
      var ttl = titlesByRaffleId[rid2] ? escapeHtml(titlesByRaffleId[rid2]) : "Акция #" + String(rid2);
      html += '<section class="tickets-group">';
      html += '<h3 class="tickets-group__title">' + ttl + "</h3>";
      html += '<p class="tickets-group__wholesale">Номера оптовика: <strong>' + whStr + "</strong></p>";
      html += "</section>";
    }
    if (!hasAny) return "";
    return '<section class="tickets-section"><h3 class="tickets-section__title">Оптовики</h3>' + html + "</section>";
  }

  function buildTicketsPendingHtml(pending) {
    var html = "";
    var i;
    var j;
    var clockSvg =
      '<svg class="tickets-reserved-status__icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';
    for (i = 0; i < pending.length; i++) {
      var pv = pending[i];
      var ptitle = escapeHtml(String((pv.raffle && pv.raffle.title) || ""));
      var pnums = pv.numbers || [];
      html += '<section class="tickets-group tickets-group--reserved-pending">';
      var porder = pv.order || {};
      var poid = Number(porder.id);
      var porderCode = poid > 0 ? "A" + String(poid) : "—";
      html += '<h3 class="tickets-group__title">' + ptitle + "</h3>";
      html += '<p class="tickets-group__meta">Заказ: <strong>' + escapeHtml(porderCode) + "</strong></p>";
      html += buildTrackingStatusLink(porder);
      html += buildTicketsTimelineHtml(pv.timeline);
      html += '<p class="tickets-reserved-status">' + clockSvg + "на проверке (" + String(pnums.length) + ")</p>";
      html += '<div class="tickets-chips tickets-chips--pending">';
      for (j = 0; j < pnums.length; j++) {
        var pj = pnums[j];
        html += '<span class="tickets-chip tickets-chip--readonly">№ ' + escapeHtml(String(pj)) + "</span>";
      }
      html += "</div></section>";
    }
    return html;
  }

  function updateTicketsModalSubtitle() {
    var el = document.getElementById("modal-tickets-subtitle");
    if (!el) return;
    var reserved = ticketsModalDataCache.reserved || [];
    var pending = ticketsModalDataCache.pending_review || [];
    var confirmed = ticketsModalDataCache.confirmed || [];
    var n = 0;
    [reserved, pending, confirmed].forEach(function (arr) {
      (arr || []).forEach(function (it) {
        var st = it.raffle && it.raffle.status;
        if (st === "active") {
          n += (it.numbers && it.numbers.length) || 0;
        }
      });
    });
    if (n > 0) {
      el.hidden = false;
      el.textContent = String(n) + " шт.";
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  }

  function paintTicketsModalBody() {
    var body = document.getElementById("modal-tickets-body");
    if (!body) return;
    var reserved = ticketsModalDataCache.reserved || [];
    var pending = ticketsModalDataCache.pending_review || [];
    var confirmed = ticketsModalDataCache.confirmed || [];
    var bothEmpty = !reserved.length && !pending.length && !confirmed.length;
    if (bothEmpty) {
      body.innerHTML = ticketsEmptyAllHtml();
      updateTicketsModalSubtitle();
      return;
    }
    var html = "";
    if (reserved.length) {
      html += '<section class="tickets-section"><h3 class="tickets-section__title">Забронированные</h3>';
      html += buildTicketsReservedHtml(reserved);
      html += "</section>";
    }
    if (pending.length) {
      html += '<section class="tickets-section"><h3 class="tickets-section__title">На проверке</h3>';
      html += buildTicketsPendingHtml(pending);
      html += "</section>";
    }
    if (confirmed.length) {
      html += '<section class="tickets-section"><h3 class="tickets-section__title">Утвержденные</h3>';
      html += buildTicketsConfirmedHtml(confirmed);
      html += "</section>";
    }
    html += buildTicketsWholesaleSectionHtml(
      ticketsModalDataCache.wholesale_slots || [],
      reserved,
      pending,
      confirmed,
    );
    body.innerHTML = html;
    updateTicketsModalSubtitle();
  }

  function renderTicketsModalBody(data) {
    ticketsModalDataCache = {
      reserved: data && data.reserved ? data.reserved : [],
      pending_review: data && data.pending_review ? data.pending_review : [],
      confirmed: data && data.confirmed ? data.confirmed : [],
      wholesale_slots: data && data.wholesale_slots ? data.wholesale_slots : [],
    };
    raffleDataCache.tickets = {
      reserved: ticketsModalDataCache.reserved,
      pending_review: ticketsModalDataCache.pending_review,
      confirmed: ticketsModalDataCache.confirmed,
      wholesale_slots: ticketsModalDataCache.wholesale_slots,
    };
    paintTicketsModalBody();
  }

  function isTicketsGuideDismissed() {
    try {
      return localStorage.getItem(TICKETS_GUIDE_DISMISS_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function dismissTicketsGuideForever() {
    try {
      localStorage.setItem(TICKETS_GUIDE_DISMISS_KEY, "1");
    } catch (_) {}
    syncTicketsGuideVisibility();
  }

  function syncTicketsGuideVisibility() {
    var hint = document.getElementById("modal-tickets-guide");
    var btn = document.getElementById("modal-tickets-guide-dismiss");
    if (!hint && !btn) return;
    var hidden = isTicketsGuideDismissed();
    if (hint) hint.hidden = hidden;
    if (btn) btn.hidden = hidden;
  }

  function setTicketLookupSuffix(suffix, kind, n) {
    if (!suffix) return;
    suffix.classList.remove(
      "tickets-lookup-suffix--free",
      "tickets-lookup-suffix--taken",
      "tickets-lookup-suffix--mine",
      "tickets-lookup-suffix--hidden",
    );
    var textEl = suffix.querySelector(".tickets-lookup-suffix__text");
    if (!Number.isFinite(n) || n < 1) {
      suffix.classList.add("tickets-lookup-suffix--hidden");
      if (textEl) textEl.textContent = "";
      return;
    }
    if (kind === "free") {
      suffix.classList.add("tickets-lookup-suffix--free");
      if (textEl) textEl.textContent = "Свободно";
      return;
    }
    if (kind === "self_reserved" || kind === "self_pending" || kind === "self_confirmed") {
      suffix.classList.add("tickets-lookup-suffix--mine");
      if (textEl) textEl.textContent = "Ваш";
      return;
    }
    suffix.classList.add("tickets-lookup-suffix--taken");
    if (textEl) textEl.textContent = kind === "error" ? "—" : "Занято";
  }

  function ticketsModalAfterMutation() {
    syncCartChrome().catch(function () {});
    return refreshTicketsModalContent();
  }

  function getLocalRaffleSelectionCountForCart() {
    if (!IS_RAFFLE_PURCHASE_PAGE) return 0;
    if (!authVerified) return 0;
    if (raffleDetailState.order) return 0;
    return raffleDetailState.selected ? raffleDetailState.selected.size : 0;
  }

  function applyCartBadgeFromItems(items) {
    var tabCart = document.getElementById("tab-cart");
    var badge = document.getElementById("cart-nav-badge");
    if (!tabCart) return;
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      total += ((items[i].numbers && items[i].numbers.length) || 0);
    }
    total += getLocalRaffleSelectionCountForCart();
    var prev = lastCartChromeTotal;
    if (total > 0) {
      tabCart.classList.add("bottom-nav-btn--cart-has-items");
      if (badge) {
        badge.hidden = false;
        badge.textContent = total > 99 ? "99+" : String(total);
        if (prev >= 0 && total > prev) {
          badge.classList.remove("cart-nav-badge--bounce");
          void badge.offsetWidth;
          badge.classList.add("cart-nav-badge--bounce");
          window.setTimeout(function () {
            badge.classList.remove("cart-nav-badge--bounce");
          }, 600);
        }
      }
      lastCartChromeTotal = total;
    } else {
      lastCartChromeTotal = 0;
      tabCart.classList.remove("bottom-nav-btn--cart-has-items");
      if (badge) {
        badge.hidden = true;
        badge.textContent = "";
        badge.classList.remove("cart-nav-badge--bounce");
      }
    }
  }

  function applyCartModalContext() {
    var sheet = document.getElementById("modal-cart-sheet");
    var tipH = document.getElementById("modal-cart-tip-home");
    var tipR = document.getElementById("modal-cart-tip-raffle");
    var onRaffle = IS_RAFFLE_PURCHASE_PAGE;
    if (sheet) {
      sheet.classList.toggle("cart-sheet--context-raffle", !!onRaffle);
      sheet.classList.toggle("cart-sheet--context-home", !onRaffle);
    }
    if (tipH) tipH.hidden = !!onRaffle;
    if (tipR) tipR.hidden = !onRaffle;
  }

  function setCartCheckoutLoading(loading) {
    var btn = document.getElementById("modal-cart-checkout");
    var sp = document.getElementById("modal-cart-checkout-spinner");
    var lab = document.getElementById("modal-cart-checkout-label");
    if (!btn || !lab) return;
    if (loading) {
      btn.classList.add("cart-sheet__cta--loading");
      btn.disabled = true;
      if (sp) sp.hidden = false;
      lab.textContent = "Подождите...";
    } else {
      btn.classList.remove("cart-sheet__cta--loading");
      if (sp) sp.hidden = true;
    }
  }

  async function fetchCartFromApi() {
    var s = loadSession();
    if (!s || !s.token || !authVerified) {
      raffleDataCache.cart = null;
      throw new Error("no auth");
    }
    var res = await fetch("/api/raffles/cart", { cache: "no-store", headers: authHeaders() });
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || "Ошибка");
    applyRaffleServerTimeSkewFromPayload(data);
    var items = data.items || [];
    raffleDataCache.cart = { items: items };
    applyCartBadgeFromItems(items);
    return raffleDataCache.cart;
  }

  async function fetchTicketsFromApi() {
    var s = loadSession();
    if (!s || !s.token || !authVerified) {
      raffleDataCache.tickets = null;
      throw new Error("no auth");
    }
    var res = await fetch("/api/raffles/my-tickets", { cache: "no-store", headers: authHeaders() });
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || "Ошибка");
    applyRaffleServerTimeSkewFromPayload(data);
    var payload = {
      reserved: data.reserved || [],
      pending_review: data.pending_review || [],
      confirmed: data.confirmed || [],
      wholesale_slots: data.wholesale_slots || [],
    };
    raffleDataCache.tickets = payload;
    syncTicketsNavBadge();
    return payload;
  }

  function prefetchRaffleCaches() {
    return Promise.all([fetchCartFromApi().catch(function () {}), fetchTicketsFromApi().catch(function () {})]);
  }

  async function refreshTicketsModalContent() {
    var s = loadSession();
    if (!s || !s.token || !authVerified) return;
    try {
      var data = await fetchTicketsFromApi();
      if (modalTickets && modalTickets.classList.contains("is-open")) {
        renderTicketsModalBody(data);
      }
      syncProfileTicketCount();
    } catch (e) {
      var em = String((e && e.message) || "Ошибка");
      if (em === "SESSION_EXPIRED") {
        showActionErrorModal("Сессия истекла", "Войдите снова, чтобы обновить билеты.", function () {
          openModal(modalLogin);
        });
      } else {
        showToast(em, "error");
      }
    }
  }

  async function openTicketsModal() {
    if (!modalTickets) return;
    var s = loadSession();
    if (!s || !s.token) {
      openModal(modalLogin);
      return;
    }
    if (!authVerified) return;
    ticketsModalActiveTab = "reserved";
    closeChatPanel();
    closeCartModal();
    closeTicketSearchModal();
    if (modalProfile) closeModal(modalProfile);
    var body = document.getElementById("modal-tickets-body");
    if (body) body.innerHTML = renderTicketsLoadingSkeleton();
    try {
      if (!raffleDataCache.tickets) {
        await fetchTicketsFromApi();
      }
      renderTicketsModalBody(
        raffleDataCache.tickets || {
          reserved: [],
          pending_review: [],
          confirmed: [],
          wholesale_slots: [],
        },
      );
    } catch (e) {
      var em = String((e && e.message) || "Ошибка");
      if (em === "SESSION_EXPIRED") {
        showActionErrorModal("Сессия истекла", "Войдите снова, чтобы открыть билеты.", function () {
          openModal(modalLogin);
        });
      } else {
        showActionErrorModal("Не удалось загрузить билеты", em, function () {
          openTicketsModal().catch(function () {});
        });
      }
      renderTicketsModalBody({ reserved: [], pending_review: [], confirmed: [], wholesale_slots: [] });
    }
    openModal(modalTickets);
    setBottomNavActive();
  }

  async function syncCartChrome() {
    var tabCart = document.getElementById("tab-cart");
    var badge = document.getElementById("cart-nav-badge");
    if (!tabCart) return;
    var s = loadSession();
    if (!s || !s.token || !authVerified) {
      lastCartChromeTotal = 0;
      raffleDataCache.cart = null;
      raffleDataCache.tickets = null;
      tabCart.classList.remove("bottom-nav-btn--cart-has-items");
      syncTicketsNavBadge();
      if (badge) {
        badge.hidden = true;
        badge.textContent = "";
        badge.classList.remove("cart-nav-badge--bounce");
      }
      return;
    }
    try {
      await fetchCartFromApi();
    } catch (_) {
      lastCartChromeTotal = 0;
      tabCart.classList.remove("bottom-nav-btn--cart-has-items");
      if (badge) {
        badge.hidden = true;
        badge.textContent = "";
        badge.classList.remove("cart-nav-badge--bounce");
      }
    }
  }

  function updateCartBuyerDisplay() {
    var av = document.getElementById("modal-cart-buyer-avatar");
    var nm = document.getElementById("modal-cart-buyer-name");
    var ph = document.getElementById("modal-cart-buyer-phone");
    if (!av || !nm || !ph) return;
    var s = loadSession();
    if (!s || !s.token || !authVerified) {
      av.textContent = "?";
      nm.textContent = "—";
      ph.textContent = "—";
      return;
    }
    var name = String(s.name || "").trim();
    var phone = String(s.phone || "");
    nm.textContent = name || "Без имени";
    ph.textContent = phone ? formatRuPhone(phone) : "—";
    var letter = "?";
    if (name.length) letter = name.charAt(0).toUpperCase();
    else if (phone.length >= 2) letter = phone.slice(-2);
    av.textContent = letter;
  }

  function renderCartModalBody(items) {
    var numbersRoot = document.getElementById("modal-cart-numbers-root");
    var btnCheckout = document.getElementById("modal-cart-checkout");
    var hintEl = document.getElementById("modal-cart-multi-hint");
    var summaryEl = document.getElementById("modal-cart-summary");
    var checkoutLabel = document.getElementById("modal-cart-checkout-label");
    if (!numbersRoot) return;
    var onRaffle = IS_RAFFLE_PURCHASE_PAGE;
    var chipRemoveSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

    function chipHtml(oid, n) {
      return (
        '<div class="cart-modal__chip">' +
        '<button type="button" class="cart-modal__chip-remove" data-cart-remove="1" data-order-id="' +
        String(oid) +
        '" data-ticket="' +
        String(n) +
        '" aria-label="Убрать номер ' +
        escapeHtml(String(n)) +
        '">' +
        chipRemoveSvg +
        "</button>" +
        '<button type="button" class="cart-modal__chip-num" data-cart-remove="1" data-order-id="' +
        String(oid) +
        '" data-ticket="' +
        String(n) +
        '" aria-label="Убрать номер ' +
        escapeHtml(String(n)) +
        '">' +
        escapeHtml(String(n)) +
        "</button></div>"
      );
    }

    function chipHtmlDraft(n) {
      return (
        '<div class="cart-modal__chip">' +
        '<button type="button" class="cart-modal__chip-remove" data-cart-draft-remove="1" data-ticket="' +
        String(n) +
        '" aria-label="Убрать номер ' +
        escapeHtml(String(n)) +
        '">' +
        chipRemoveSvg +
        "</button>" +
        '<button type="button" class="cart-modal__chip-num" data-cart-draft-remove="1" data-ticket="' +
        String(n) +
        '" aria-label="Убрать номер ' +
        escapeHtml(String(n)) +
        '">' +
        escapeHtml(String(n)) +
        "</button></div>"
      );
    }

    var draftNums = [];
    if (onRaffle && !raffleDetailState.order && raffleDetailState.selected && raffleDetailState.selected.size) {
      draftNums = Array.from(raffleDetailState.selected).sort(function (a, b) {
        return a - b;
      });
    }

    if ((!items || !items.length) && !draftNums.length) {
      if (onRaffle) {
        numbersRoot.innerHTML =
          '<div class="cart-modal__chips-row">' +
          '<button type="button" class="cart-modal__add-slot" data-cart-add-more="1" aria-label="Добавить номерки">+</button>' +
          "</div>";
      } else {
        numbersRoot.innerHTML = '<div class="cart-modal__numbers-empty"></div>';
      }
      if (btnCheckout) {
        btnCheckout.disabled = true;
        btnCheckout.removeAttribute("data-checkout-raffle-id");
      }
      if (checkoutLabel) checkoutLabel.textContent = onRaffle ? "Выберите номерки" : "Корзина пуста";
      if (hintEl) {
        hintEl.hidden = true;
        hintEl.textContent = "";
      }
      if (summaryEl) {
        summaryEl.hidden = true;
        summaryEl.textContent = "";
      }
      setCartCheckoutLoading(false);
      return;
    }
    var html = "";
    var totalNums = 0;
    var totalAmount = 0;
    var i;
    var j;
    for (i = 0; i < (items || []).length; i++) {
      var it = items[i];
      var title = escapeHtml(String((it.raffle && it.raffle.title) || ""));
      var oid = Number(it.order && it.order.id);
      var nums = it.numbers || [];
      totalNums += nums.length;
      totalAmount += Number(it.order && it.order.amount_rub ? it.order.amount_rub : 0);
      if (items.length > 1) {
        html += '<p class="cart-modal__raffle-name">' + title + "</p>";
      }
      html += '<div class="cart-modal__chips-row">';
      for (j = 0; j < nums.length; j++) {
        html += chipHtml(oid, nums[j]);
      }
      if (onRaffle && i === items.length - 1) {
        html +=
          '<button type="button" class="cart-modal__add-slot" data-cart-add-more="1" aria-label="Добавить номерки">+</button>';
      }
      html += "</div>";
    }
    if (draftNums.length) {
      var draftTitle = escapeHtml(
        String((raffleDetailState.raffle && raffleDetailState.raffle.title) || ""),
      );
      if (items && items.length) {
        html += '<p class="cart-modal__raffle-name">' + draftTitle + " (выбор)</p>";
      }
      html += '<div class="cart-modal__chips-row">';
      for (j = 0; j < draftNums.length; j++) {
        html += chipHtmlDraft(draftNums[j]);
      }
      html +=
        '<button type="button" class="cart-modal__add-slot" data-cart-add-more="1" aria-label="Добавить номерки">+</button>';
      html += "</div>";
      totalNums += draftNums.length;
      if (raffleDetailState.raffle && raffleDetailState.raffle.price_rub != null) {
        totalAmount += draftNums.length * Number(raffleDetailState.raffle.price_rub || 0);
      }
    }
    numbersRoot.innerHTML = html;
    if (btnCheckout) {
      btnCheckout.disabled = totalNums < 1;
      btnCheckout.removeAttribute("data-checkout-draft");
      var firstRaffleId =
        (items && items[0] && items[0].raffle && items[0].raffle.id) ||
        (raffleDetailState.raffle && raffleDetailState.raffle.id);
      if (firstRaffleId != null && totalNums > 0) {
        btnCheckout.setAttribute("data-checkout-raffle-id", String(firstRaffleId));
      } else {
        btnCheckout.removeAttribute("data-checkout-raffle-id");
      }
      if ((!items || !items.length) && draftNums.length) {
        btnCheckout.setAttribute("data-checkout-draft", "1");
      }
    }
    if (checkoutLabel) {
      if (onRaffle && totalNums > 0) {
        checkoutLabel.textContent = "Забронировать (" + String(totalNums) + ") >";
      } else {
        checkoutLabel.textContent = "К оплате";
      }
    }
    if (summaryEl) {
      summaryEl.hidden = false;
      summaryEl.textContent =
        "К оплате: " + formatRubleAmount(totalAmount) + " ₽, номерков: " + String(totalNums);
    }
    if (hintEl) {
      if (items.length > 1) {
        hintEl.hidden = false;
        hintEl.textContent =
          "Несколько заявок — кнопка откроет первую. Остальные оплатите по очереди из корзины.";
      } else {
        hintEl.hidden = true;
        hintEl.textContent = "";
      }
    }
    setCartCheckoutLoading(false);
  }

  async function openCartModal() {
    if (!modalCart) return;
    var s = loadSession();
    if (!s || !s.token) {
      openModal(modalLogin);
      return;
    }
    if (!authVerified) return;
    applyCartModalContext();
    updateCartBuyerDisplay();
    closeChatPanel();
    closeTicketsModal();
    closeTicketSearchModal();
    if (modalProfile) closeModal(modalProfile);
    var tcb = document.getElementById("tab-cart");
    if (tcb) tcb.classList.add("bottom-nav-btn--cart-open");
    setCartCheckoutLoading(false);
    try {
      if (!raffleDataCache.cart) {
        await fetchCartFromApi();
      }
      renderCartModalBody(raffleDataCache.cart ? raffleDataCache.cart.items : []);
    } catch (e) {
      if (String(e.message || "") !== "no auth") {
        showToast(String(e.message || "Ошибка"), "error");
      }
      renderCartModalBody([]);
    }
    openModal(modalCart);
    setBottomNavActive();
  }

  function raffleDetailEl(suffix) {
    return document.getElementById(raffleDetailState.elPrefix + "-" + suffix);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatRubleAmount(n) {
    return String(Math.max(0, Math.round(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function homeFeedEmptyStateHtml(variant) {
    var isError = variant === "error";
    var iconGift =
      '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      "<path d=\"M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8\"></path>" +
      "<path d=\"M4 12V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5\"></path>" +
      "<path d=\"M12 22V7\"></path>" +
      "<path d=\"M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z\"></path>" +
      "<path d=\"M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z\"></path>" +
      "</svg>";
    var iconWarn =
      '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      "<path d=\"M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z\"></path>" +
      "<line x1=\"12\" y1=\"9\" x2=\"12\" y2=\"13\"></line>" +
      "<line x1=\"12\" y1=\"17\" x2=\"12.01\" y2=\"17\"></line>" +
      "</svg>";
    var title = isError ? "Не удалось загрузить акции" : "Пока нет акций";
    var text = isError
      ? "Проверьте интернет и попробуйте ещё раз. Если проблема останется — напишите в чат поддержки."
      : "Когда появится новая акция, она будет здесь. А пока загляните в билеты или напишите нам — всегда рады помочь.";
    var actions = isError
      ? '<button type="button" class="home-feed-empty__btn home-feed-empty__btn--primary" data-home-feed-retry>Обновить</button>' +
        '<button type="button" class="home-feed-empty__btn home-feed-empty__btn--ghost" data-home-feed-open-chat>Чат</button>'
      : '<button type="button" class="home-feed-empty__btn home-feed-empty__btn--primary" data-home-feed-open-chat>Написать в чат</button>';
    return (
      '<div class="home-feed-empty' +
      (isError ? " home-feed-empty--error" : "") +
      '" role="status">' +
      '<div class="home-feed-empty__card">' +
      '<div class="home-feed-empty__glow" aria-hidden="true"></div>' +
      '<div class="home-feed-empty__icon-wrap" aria-hidden="true">' +
      (isError ? iconWarn : iconGift) +
      "</div>" +
      '<h2 class="home-feed-empty__title">' +
      escapeHtml(title) +
      "</h2>" +
      '<p class="home-feed-empty__text">' +
      escapeHtml(text) +
      "</p>" +
      '<div class="home-feed-empty__actions">' +
      actions +
      "</div></div></div>"
    );
  }

  function bindHomeFeedEmptyActions(container) {
    if (!container) return;
    var openChat = container.querySelector("[data-home-feed-open-chat]");
    if (openChat) {
      openChat.addEventListener("click", function () {
        openChatPanel();
      });
    }
    var retry = container.querySelector("[data-home-feed-retry]");
    if (retry) {
      retry.addEventListener("click", function () {
        loadRafflesFeed();
      });
    }
  }

  function buildRaffleCardHtml(r, idx) {
    var st = String(r.status || "active");
    var myOrderStatus = String(r.my_order_status || "");
    var badgeBlock = "";
    if (st === "active" && myOrderStatus === "reserved") {
      badgeBlock =
        '<div class="raffle-card__badge-wrap raffle-card__badge-wrap--wait-check">' +
        '<div class="raffle-card__badge raffle-card__badge--wait-check">Ждём чек</div>' +
        "</div>";
    } else if (st === "paused") {
      badgeBlock =
        '<div class="raffle-card__badge-wrap raffle-card__badge-wrap--paused">' +
        '<div class="raffle-card__badge raffle-card__badge--pause">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="12" cy="12" r="10"></circle><path d="M12 8v4M12 16h.01"></path></svg>' +
        " Техническая пауза" +
        "</div>" +
        '<div class="raffle-card__sub">Скоро вернёмся</div>' +
        "</div>";
    } else if (st === "closed") {
      badgeBlock =
        '<div class="raffle-card__badge-wrap raffle-card__badge-wrap--closed">' +
        '<div class="raffle-card__badge raffle-card__badge--pause">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>' +
        " Продажи закрыты" +
        "</div>" +
        '<div class="raffle-card__sub">Следите за новостями</div>' +
        "</div>";
    }
    var cover = "";
    if (r.cover_image_url && String(r.cover_image_url).trim()) {
      cover =
        '<img src="' +
        escapeHtml(String(r.cover_image_url)) +
        '" alt="" width="480" height="160" loading="lazy" />';
    }
    var ctaClass = "raffle-card__cta raffle-card__cta--dark";
    var ctaLabel = st === "active" || st === "paused" || st === "closed" ? "Участвовать" : "Подробнее";
    var ctaDisabledAttr = st === "paused" || st === "closed" ? ' disabled aria-disabled="true"' : "";
    var viewers = Math.max(0, Number(r.viewers_count) || 0);
    var total = Math.max(0, Number(r.ticket_count) || 0);
    var occupied = Math.max(0, Math.min(total, Number(r.occupied_count) || 0));
    var free = Math.max(0, total - occupied);
    var occupiedPct = total > 0 ? (occupied / total) * 100 : 0;
    var freePct = total > 0 ? (free / total) * 100 : 0;
    var progressClass =
      occupiedPct >= 90
        ? "raffle-card__progress-fill--danger"
        : occupiedPct >= 75
          ? "raffle-card__progress-fill--warn"
          : "raffle-card__progress-fill--ok";
    var prevFreePct = Number(raffleCardPrevFreePct[String(r.id)]);
    var startPct = Number.isFinite(prevFreePct) ? prevFreePct : freePct;
    var pr = Number(r.price_rub ?? 0);
    var priceInner = escapeHtml(formatRubleAmount(pr)) + "&nbsp;₽";
    var viewersBlock =
      st === "paused" || st === "closed" || viewers <= 0
        ? ""
        : '<div class="raffle-card__viewers" aria-label="Смотрят акцию сейчас">' +
          '<span class="raffle-card__viewers-dot" aria-hidden="true"></span>' +
          "<span>Смотрят: " +
          escapeHtml(String(viewers)) +
          " чел.</span></div>";
    return (
      '<article class="raffle-card' +
      (st === "active" ? " raffle-card--active" : "") +
      '" data-raffle-open="1" data-raffle-idx="' +
      idx +
      '" data-status="' +
      escapeHtml(st) +
      '">' +
      '<div class="raffle-card__media">' +
      cover +
      '<div class="raffle-card__grad"></div>' +
      viewersBlock +
      badgeBlock +
      '<h3 class="raffle-card__title">' +
      escapeHtml(String(r.title || "")) +
      "</h3>" +
      "</div>" +
      '<div class="raffle-card__foot">' +
      '<div class="raffle-card__progress-wrap">' +
      '<div class="raffle-card__progress-meta">' +
      "<span>Занято: " +
      escapeHtml(String(occupied)) +
      "</span>" +
      "<span>Осталось: " +
      escapeHtml(String(free)) +
      "</span>" +
      "</div>" +
      '<div class="raffle-card__progress-track" role="img" aria-label="Осталось ' +
      escapeHtml(String(Math.round(freePct))) +
      ' процентов">' +
      '<span class="raffle-card__progress-fill ' +
      progressClass +
      '" style="width:' +
      String(Math.max(0, Math.min(100, startPct)).toFixed(1)) +
      '%" data-target-width="' +
      String(Math.max(0, Math.min(100, freePct)).toFixed(1)) +
      '%"></span>' +
      "</div>" +
      "</div>" +
      '<div class="raffle-card__price-row">' +
      '<div class="raffle-card__price">' +
      priceInner +
      ' <span class="raffle-card__price-suffix">/ билет</span></div>' +
      '<button type="button" class="' +
      ctaClass +
      '" data-raffle-open="1" data-raffle-idx="' +
      idx +
      '"' +
      ctaDisabledAttr +
      ">" +
      ctaLabel +
      "</button></div>" +
      "</div></article>"
    );
  }

  function renderRaffleCards(containerId, list) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!list || !list.length) {
      el.innerHTML = homeFeedEmptyStateHtml("empty");
      bindHomeFeedEmptyActions(el);
      return;
    }
    raffleCardPrevFreePct = Object.create(null);
    for (var p = 0; p < raffleDetailCache.length; p++) {
      var pr = raffleDetailCache[p];
      var tid = String(pr && pr.id != null ? pr.id : "");
      var totalP = Math.max(0, Number(pr && pr.ticket_count) || 0);
      var occP = Math.max(0, Math.min(totalP, Number(pr && pr.occupied_count) || 0));
      var freeP = Math.max(0, totalP - occP);
      if (tid) raffleCardPrevFreePct[tid] = totalP > 0 ? (freeP / totalP) * 100 : 0;
    }
    raffleDetailCache = list.slice();
    el.innerHTML = list
      .map(function (r, idx) {
        return buildRaffleCardHtml(r, idx);
      })
      .join("");
    window.requestAnimationFrame(function () {
      el.querySelectorAll(".raffle-card__progress-fill[data-target-width]").forEach(function (bar) {
        var target = bar.getAttribute("data-target-width");
        if (!target) return;
        bar.style.width = target;
      });
    });
    el.querySelectorAll("[data-raffle-open]").forEach(function (node) {
      node.addEventListener("click", function (e) {
        if (node.tagName === "BUTTON") e.stopPropagation();
        var i = Number(node.getAttribute("data-raffle-idx"));
        var r = raffleDetailCache[i];
        if (r) {
          var rst = String(r.status || "active");
          if (rst === "active") {
            location.href = "/home/raffle?id=" + encodeURIComponent(String(r.id));
          } else if (rst === "paused" || rst === "closed") {
            return;
          }
        }
      });
    });
  }

  async function loadRafflesFeed() {
    if (IS_GUEST_LANDING) {
      return;
    }
    var feedRoot = document.getElementById("home-cards-app");
    if (feedRoot && !feedRoot.children.length) {
      renderFeedSkeleton("home-cards-app");
    }
    try {
      const res = await fetch("/api/raffles", {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (res.status === 401) throw new Error("SESSION_EXPIRED");
      const data = await res.json().catch(function () {
        return {};
      });
      if (res.status === 403 && data.code === "account_blocked") {
        accountBlocked = true;
        refreshAccountBlockedUI();
        renderDashboard();
        return;
      }
      if (res.status === 503 && data.code === "maintenance") {
        location.replace("/maintenance");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Ошибка");
      var list = data.raffles || [];
      renderRaffleCards("home-cards-app", list);
    } catch (err) {
      var ap = document.getElementById("home-cards-app");
      if (ap) {
        ap.innerHTML = homeFeedEmptyStateHtml("error");
        bindHomeFeedEmptyActions(ap);
      }
      var msg = String((err && err.message) || "");
      if (msg === "SESSION_EXPIRED") {
        showActionErrorModal("Сессия истекла", "Войдите снова, чтобы загрузить акции.", function () {
          openModal(modalLogin);
        });
      }
    }
  }

  function startHomeRafflesAutoRefresh() {
    if (homeRafflesRefreshTimer) return;
    homeRafflesRefreshTimer = setInterval(function () {
      if (!IS_HOME_APP || !authVerified || accountBlocked) return;
      loadRafflesFeed();
    }, 60 * 1000);
  }

  function stopRaffleViewHeartbeat() {
    if (raffleViewHeartbeatTimer) {
      clearInterval(raffleViewHeartbeatTimer);
      raffleViewHeartbeatTimer = null;
    }
  }

  function stopRafflePageViewersAutoRefresh() {
    if (rafflePageViewersRefreshTimer) {
      clearInterval(rafflePageViewersRefreshTimer);
      rafflePageViewersRefreshTimer = null;
    }
  }

  async function refreshRafflePageViewersCount(raffleId) {
    var viewersEl = document.getElementById("raffle-page-viewers");
    var viewersTextEl = document.getElementById("raffle-page-viewers-text");
    if (!viewersEl || !viewersTextEl) return;
    if (!Number.isFinite(Number(raffleId)) || Number(raffleId) < 1) return;
    try {
      var res = await fetch("/api/raffles", { cache: "no-store", headers: authHeaders() });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !Array.isArray(data.raffles)) return;
      var rid = Number(raffleId);
      var found = null;
      for (var i = 0; i < data.raffles.length; i++) {
        if (Number(data.raffles[i] && data.raffles[i].id) === rid) {
          found = data.raffles[i];
          break;
        }
      }
      if (!found) return;
      var viewersCount = Math.max(0, Number(found.viewers_count) || 0);
      viewersTextEl.textContent = "Онлайн: " + String(viewersCount);
      viewersEl.hidden = viewersCount <= 0;
      if (raffleDetailState.raffle && Number(raffleDetailState.raffle.id) === rid) {
        raffleDetailState.raffle.viewers_count = viewersCount;
      }
    } catch (_) {}
  }

  function startRafflePageViewersAutoRefresh(raffleId) {
    stopRafflePageViewersAutoRefresh();
    if (!Number.isFinite(Number(raffleId)) || Number(raffleId) < 1) return;
    refreshRafflePageViewersCount(raffleId).catch(function () {});
    rafflePageViewersRefreshTimer = setInterval(function () {
      if (document.visibilityState !== "visible") return;
      refreshRafflePageViewersCount(raffleId).catch(function () {});
    }, 60 * 1000);
  }

  function pingRaffleView(raffleId) {
    if (!Number.isFinite(Number(raffleId)) || Number(raffleId) < 1) return;
    if (!authVerified || document.visibilityState !== "visible") return;
    fetch("/api/raffles/" + String(raffleId) + "/viewing", {
      method: "POST",
      headers: authHeaders(),
      cache: "no-store",
    }).catch(function () {});
  }

  function startRaffleViewHeartbeat(raffleId) {
    stopRaffleViewHeartbeat();
    if (!Number.isFinite(Number(raffleId)) || Number(raffleId) < 1) return;
    pingRaffleView(raffleId);
    raffleViewHeartbeatTimer = setInterval(function () {
      pingRaffleView(raffleId);
    }, 50 * 1000);
  }

  function updateRaffleSelectionLabel() {
    var n = raffleDetailState.selected.size;
    var el = raffleDetailEl("selection");
    if (el) el.textContent = "Выбрано: " + String(n) + " / " + String(RAFFLE_MAX_SELECT);
    var reserveBtn = document.getElementById("raffle-page-reserve");
    if (reserveBtn) {
      if (n > 0) {
        reserveBtn.textContent = "Забронировать (" + String(n) + ")";
        reserveBtn.classList.remove("raffle-reserve-btn--empty");
      } else {
        reserveBtn.textContent = "Выберите номера";
        reserveBtn.classList.add("raffle-reserve-btn--empty");
      }
    }
    if (modalTicketSearch && modalTicketSearch.classList.contains("is-open")) {
      updateTicketSearchRandomPanel();
      renderTicketSearchPickedFooter();
    }
    applyCartBadgeFromItems(raffleDataCache.cart && raffleDataCache.cart.items ? raffleDataCache.cart.items : []);
    if (raffleDraftHydrated) persistRaffleDraftSelection();
  }

  function startRaffleReserveTimer(untilTs) {
    clearRaffleDetailTimer();
    scheduleReservationReminder(untilTs);
    var legacyTimer = document.getElementById("raffle-page-timer");
    var checkoutTimerText = document.getElementById("raffle-page-checkout-timer-text");
    function tick() {
      var left = getRaffleReservationLeftMs(untilTs);
      var dl = formatReserveDeadlineMoscow(untilTs);
      var dlPart = dl ? " · до " + dl + " МСК" : "";
      var text =
        left <= 0
          ? "Бронь истекла"
          : "Осталось " +
            String(Math.floor(left / 60000)) +
            " мин " +
            String(Math.floor((left % 60000) / 1000)).padStart(2, "0") +
            " с" +
            dlPart;
      if (legacyTimer) legacyTimer.hidden = true;
      if (checkoutTimerText) checkoutTimerText.textContent = text;
      if (left <= 0) {
        clearRaffleDetailTimer();
      }
    }
    tick();
    raffleDetailState.timerId = setInterval(tick, 1000);
  }

  function updateRafflePurchaseChrome() {
    var layout = document.getElementById("raffle-purchase-layout");
    if (!layout) return;
    var order = raffleDetailState.order;
    var nums = raffleDetailState.orderNumbers || [];
    var r = raffleDetailState.raffle;
    var legacyTimer = document.getElementById("raffle-page-timer");

    if (IS_RAFFLE_PAY_PAGE) {
      var mainBlock = document.getElementById("raffle-pay-main-block");
      var payNums = document.getElementById("raffle-pay-numbers");
      var extendBtn = document.getElementById("raffle-page-extend");
      var payTitle = document.getElementById("raffle-pay-page-title");
      if (legacyTimer) legacyTimer.hidden = true;
      if (payTitle) payTitle.textContent = "Оплата";
      var stPay = order ? String(order.status) : "";
      if (stPay === "pending_review") {
        if (mainBlock) mainBlock.hidden = true;
        layout.classList.remove("raffle-purchase-layout--checkout");
        return;
      }
      if (stPay === "reserved" && order) {
        if (mainBlock) mainBlock.hidden = false;
        layout.classList.add("raffle-purchase-layout--checkout");
        if (payNums) {
          if (nums.length > 0 && order.id != null) {
            var oidPay = Number(order.id);
            payNums.innerHTML = nums
              .map(function (n) {
                return (
                  '<div class="raffle-pay-num-row">' +
                  '<button type="button" class="raffle-pay-num-remove" data-raffle-pay-remove="1" data-order-id="' +
                  String(oidPay) +
                  '" data-ticket="' +
                  String(n) +
                  '" aria-label="Убрать номер ' +
                  escapeHtml(String(n)) +
                  '">' +
                  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
                  '<span class="raffle-pay-num-label">№ ' +
                  escapeHtml(String(n)) +
                  "</span></div>"
                );
              })
              .join("");
          } else {
            payNums.innerHTML = "";
          }
        }
        if (extendBtn) {
          extendBtn.hidden = true;
          extendBtn.disabled = true;
        }
        return;
      }
      if (mainBlock) mainBlock.hidden = true;
      layout.classList.remove("raffle-purchase-layout--checkout");
      return;
    }

    if (IS_RAFFLE_PURCHASE_PAGE) {
      var gridToolsPurchase = document.getElementById("raffle-page-topbar-grid-tools");
      var checkoutBarPurchase = document.getElementById("raffle-page-checkout-bar");
      var headingBlockPurchase = document.getElementById("raffle-page-heading-block");
      var checkoutHeadPurchase = document.getElementById("raffle-page-checkout-head");
      var topSpacerPurchase = document.getElementById("raffle-page-topbar-spacer");
      layout.classList.remove("raffle-purchase-layout--checkout");
      if (gridToolsPurchase) gridToolsPurchase.hidden = false;
      if (topSpacerPurchase) topSpacerPurchase.hidden = true;
      if (checkoutBarPurchase) checkoutBarPurchase.hidden = true;
      if (headingBlockPurchase) headingBlockPurchase.hidden = false;
      if (checkoutHeadPurchase) checkoutHeadPurchase.hidden = true;
      if (legacyTimer) legacyTimer.hidden = true;
      return;
    }

    var gridTools = document.getElementById("raffle-page-topbar-grid-tools");
    var checkoutBar = document.getElementById("raffle-page-checkout-bar");
    var headingBlock = document.getElementById("raffle-page-heading-block");
    var checkoutHead = document.getElementById("raffle-page-checkout-head");
    var checkoutTitleEl = document.getElementById("raffle-page-checkout-title");
    var numsEl = document.getElementById("raffle-page-checkout-numbers");
    var extendBtnTop = document.getElementById("raffle-page-extend");
    var topSpacer = document.getElementById("raffle-page-topbar-spacer");
    var inCheckout = order && String(order.status) === "reserved";
    if (inCheckout) {
      layout.classList.add("raffle-purchase-layout--checkout");
      if (gridTools) gridTools.hidden = true;
      if (topSpacer) topSpacer.hidden = false;
      if (checkoutBar) checkoutBar.hidden = false;
      if (headingBlock) headingBlock.hidden = true;
      if (checkoutHead) checkoutHead.hidden = false;
      if (checkoutTitleEl && r) checkoutTitleEl.textContent = String(r.title || "Акция");
      if (legacyTimer) legacyTimer.hidden = true;
      if (numsEl) {
        if (nums.length > 0) {
          numsEl.innerHTML =
            '<span class="raffle-checkout-bar__label">Ваши номерки</span><div class="raffle-checkout-chips">' +
            nums
              .map(function (n) {
                return '<span class="raffle-checkout-chip">№ ' + escapeHtml(String(n)) + "</span>";
              })
              .join("") +
            "</div>";
        } else {
          numsEl.innerHTML = "";
        }
      }
      if (extendBtnTop) {
        extendBtnTop.hidden = true;
        extendBtnTop.disabled = true;
      }
    } else {
      layout.classList.remove("raffle-purchase-layout--checkout");
      if (gridTools) gridTools.hidden = false;
      if (topSpacer) topSpacer.hidden = true;
      if (checkoutBar) checkoutBar.hidden = true;
      if (headingBlock) headingBlock.hidden = false;
      if (checkoutHead) checkoutHead.hidden = true;
    }
  }

  function setRaffleDetailSteps(show) {
    raffleDetailState.currentPayStep = show;
    var grid = raffleDetailEl("step-grid");
    var bank = raffleDetailEl("step-bank");
    var sberM = document.getElementById("raffle-page-step-sber-method");
    var pay = raffleDetailEl("step-pay");
    var wait = raffleDetailEl("step-wait");
    if (grid) grid.hidden = IS_RAFFLE_PAY_PAGE ? true : show !== "grid";
    if (bank) bank.hidden = show !== "bank";
    if (sberM) sberM.hidden = show !== "sber-method";
    if (pay) pay.hidden = show !== "pay";
    if (wait) wait.hidden = show !== "wait";
    syncRaffleFunnelStep(show);
    updateRafflePurchaseChrome();
  }

  function syncRaffleFunnelStep(step) {
    var wrap = document.getElementById("raffle-page-funnel");
    if (!wrap) return;
    var live = document.getElementById("raffle-page-funnel-live");
    var current = "numbers";
    if (step === "bank" || step === "sber-method") current = "cart";
    else if (step === "pay" || step === "wait") current = "pay";
    var order = ["numbers", "cart", "pay"];
    var idx = order.indexOf(current);
    wrap.querySelectorAll("[data-funnel-step]").forEach(function (node) {
      var key = node.getAttribute("data-funnel-step");
      var i = order.indexOf(String(key || ""));
      node.classList.toggle("is-current", i === idx);
      node.classList.toggle("is-done", i > -1 && i < idx);
    });
    if (live) {
      var txt =
        current === "numbers"
          ? "Этап: выберите номерки."
          : current === "cart"
            ? "Этап: подтвердите номерки в корзине."
            : "Этап: выполните оплату.";
      live.textContent = txt;
    }
  }

  function rafflePayStepItem(n, bodyHtml) {
    return (
      '<li class="raffle-pay-steps__item">' +
      '<span class="raffle-pay-steps__num">' +
      String(n) +
      "</span>" +
      '<div class="raffle-pay-steps__body">' +
      bodyHtml +
      "</div></li>"
    );
  }

  function getRafflePaymentAvailability(r) {
    var sberEnabled =
      r && r.sber_enabled != null
        ? Boolean(r.sber_enabled)
        : Boolean(String((r && r.collection_url) || "").trim());
    var qrEnabled =
      r && r.qr_enabled != null
        ? Boolean(r.qr_enabled)
        : Boolean(String((r && r.qr_image_url) || "").trim());
    var hasCollection = sberEnabled && Boolean(String((r && r.collection_url) || "").trim());
    var hasQr = qrEnabled && Boolean(String((r && r.qr_image_url) || "").trim());
    return {
      hasCollection: hasCollection,
      hasQr: hasQr,
      hasAny: hasCollection || hasQr,
    };
  }

  function syncRafflePaymentButtons(r) {
    var a = getRafflePaymentAvailability(r);
    var bankSberBtn = document.querySelector('#raffle-page-flow [data-raffle-bank="sber"]');
    var bankOtherBtn = document.querySelector('#raffle-page-flow [data-raffle-bank="other"]');
    var sberCollectionBtn = document.querySelector(
      '#raffle-page-flow [data-sber-method="collection"]',
    );
    var sberQrBtn = document.querySelector('#raffle-page-flow [data-sber-method="qr"]');

    if (bankSberBtn) {
      bankSberBtn.hidden = !a.hasAny;
      bankSberBtn.disabled = !a.hasAny;
    }
    if (bankOtherBtn) {
      bankOtherBtn.hidden = !a.hasQr;
      bankOtherBtn.disabled = !a.hasQr;
    }
    if (sberCollectionBtn) {
      sberCollectionBtn.hidden = !a.hasCollection;
      sberCollectionBtn.disabled = !a.hasCollection;
    }
    if (sberQrBtn) {
      sberQrBtn.hidden = !a.hasQr;
      sberQrBtn.disabled = !a.hasQr;
    }
  }

  function renderRafflePayBody(r, bank, sberMethod) {
    var payBody = raffleDetailEl("pay-body");
    if (!payBody) return;
    var o = raffleDetailState.order;
    var amountRub = o && o.amount_rub != null ? Number(o.amount_rub) : 0;
    var qr = String(r.qr_image_url || "").trim();
    var url = String(r.collection_url || "").trim();
    var html = "";
    if (bank === "sber" && sberMethod === "collection") {
      html += '<ol class="raffle-pay-steps">';
      html += rafflePayStepItem(
        1,
        url
          ? '<a class="raffle-pay-steps__link btn btn--secondary btn--sm" href="' +
              escapeHtml(url) +
              '" target="_blank" rel="noopener noreferrer">Открыть сбор</a><p class="raffle-pay-steps__txt">Нажмите на кнопку «Открыть сбор» и перейдите в приложение банка.</p>'
          : '<p class="raffle-pay-steps__txt">Нажмите на кнопку «Открыть сбор» в приложении Сбербанка (ссылка на сбор будет в чате поддержки, если не настроена).</p>',
      );
      html += rafflePayStepItem(2, "<p class=\"raffle-pay-steps__txt\">Присоединитесь к сбору.</p>");
      html += rafflePayStepItem(3, "<p class=\"raffle-pay-steps__txt\">Сдайте деньги через интерфейс сбора.</p>");
      html += rafflePayStepItem(
        4,
        '<p class="raffle-pay-steps__txt">Введите сумму <strong>' +
          escapeHtml(formatRubleAmount(amountRub)) +
          " ₽</strong> и подтвердите оплату.</p>",
      );
      html += rafflePayStepItem(
        5,
        "<p class=\"raffle-pay-steps__txt\">Сохраните чек в формате PDF или сделайте скриншот.</p>",
      );
      html += rafflePayStepItem(
        6,
        "<p class=\"raffle-pay-steps__txt\">Нажмите кнопку <strong>«Я оплатил»</strong> ниже на этой странице.</p>",
      );
      html += rafflePayStepItem(
        7,
        "<p class=\"raffle-pay-steps__txt\">На следующем экране прикрепите чек и отправьте на проверку.</p>",
      );
      html += "</ol>";
    } else if (bank === "sber" && sberMethod === "qr") {
      html += '<ol class="raffle-pay-steps">';
      html += rafflePayStepItem(
        1,
        qr
          ? '<div class="raffle-pay__qr-inline"><img src="' +
              escapeHtml(qr) +
              '" alt="QR" width="180" height="180" loading="lazy"/></div><p class="raffle-pay-steps__txt">Отсканируйте QR-код в приложении банка.</p>'
          : '<p class="raffle-pay-steps__warn">QR-код не настроен. Обратитесь в поддержку.</p>',
      );
      html += rafflePayStepItem(
        2,
        '<p class="raffle-pay-steps__txt">Укажите назначение платежа: <strong>«Оплата услуг»</strong>.</p>',
      );
      html += rafflePayStepItem(
        3,
        '<p class=\"raffle-pay-steps__txt\">Введите сумму: <strong>' +
          escapeHtml(formatRubleAmount(amountRub)) +
          " ₽</strong>.</p>",
      );
      html += rafflePayStepItem(4, "<p class=\"raffle-pay-steps__txt\">Отправьте средства.</p>");
      html += rafflePayStepItem(
        5,
        "<p class=\"raffle-pay-steps__txt\">Сохраните чек (PDF или скриншот).</p>",
      );
      html += rafflePayStepItem(
        6,
        "<p class=\"raffle-pay-steps__txt\">Нажмите <strong>«Я оплатил»</strong> ниже.</p>",
      );
      html += rafflePayStepItem(
        7,
        "<p class=\"raffle-pay-steps__txt\">Прикрепите чек и отправьте на проверку на следующем экране.</p>",
      );
      html += "</ol>";
    } else {
      html += '<ol class="raffle-pay-steps">';
      html += rafflePayStepItem(
        1,
        qr
          ? '<div class="raffle-pay__qr-inline"><img src="' +
              escapeHtml(qr) +
              '" alt="QR" width="180" height="180" loading="lazy"/></div><p class="raffle-pay-steps__txt">Отсканируйте QR-код.</p>'
          : '<p class="raffle-pay-steps__warn">QR не настроен.</p>',
      );
      html += rafflePayStepItem(
        2,
        '<p class="raffle-pay-steps__txt">Назначение: <strong>оплата услуг</strong>.</p>',
      );
      html += rafflePayStepItem(
        3,
        '<p class="raffle-pay-steps__txt">Сумма: <strong>' +
          escapeHtml(formatRubleAmount(amountRub)) +
          " ₽</strong>.</p>",
      );
      html += rafflePayStepItem(4, "<p class=\"raffle-pay-steps__txt\">Отправьте перевод и сохраните чек.</p>");
      html += rafflePayStepItem(5, "<p class=\"raffle-pay-steps__txt\">Нажмите «Я оплатил» и прикрепите чек далее.</p>");
      html += "</ol>";
    }
    var payOrderId = Number(o && o.id ? o.id : 0);
    var rulesPay = String((raffleDetailState.raffle && raffleDetailState.raffle.rules_url) || "").trim();
    if (rulesPay) {
      html +=
        '<p class="raffle-pay-rules"><a class="raffle-pay-rules__link" href="' +
        escapeHtml(rulesPay) +
        '" target="_blank" rel="noopener noreferrer">Краткие правила акции</a></p>';
    }
    html +=
      '<button type="button" class="raffle-pay-support" id="raffle-pay-support" data-order-id="' +
      String(payOrderId) +
      '" data-amount="' +
      String(amountRub) +
      '">Проблема с оплатой</button>';
    payBody.innerHTML = html;
  }

  async function loadRaffleTicketSlice() {
    var r = raffleDetailState.raffle;
    if (!r || !r.id) return;
    var id = Number(r.id);
    var from = raffleDetailState.rangeFrom;
    var to = raffleDetailState.rangeTo;
    setRaffleGridLoading(true);
    try {
      var res = await fetch(
        "/api/raffles/" + String(id) + "/tickets?from=" + String(from) + "&to=" + String(to),
        { cache: "no-store", headers: authHeaders() },
      );
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      var cells = data.cells || [];
      raffleDetailState.lastCells = cells;
      renderRaffleGrid(cells);
      scheduleRaffleFastInputLookup();
    } finally {
      setRaffleGridLoading(false);
    }
  }

  function getRangeTabForTicketN(ticketCount, n) {
    var maxN = Math.max(1, Math.floor(Number(ticketCount) || 1));
    var chunk = 500;
    if (n < 1 || n > maxN) return null;
    var start = 1;
    while (start <= maxN) {
      var end = Math.min(start + chunk - 1, maxN);
      if (n >= start && n <= end) return { from: start, to: end };
      start = end + 1;
    }
    return null;
  }

  async function ensureRaffleTabForNumber(n) {
    var r = raffleDetailState.raffle;
    if (!r || !r.id) return;
    var part = getRangeTabForTicketN(r.ticket_count, n);
    if (!part) return;
    if (raffleDetailState.rangeFrom === part.from && raffleDetailState.rangeTo === part.to) return;
    var tabs = raffleDetailEl("tabs");
    if (tabs) {
      tabs.querySelectorAll(".raffle-range-tab").forEach(function (b) {
        var f = Number(b.getAttribute("data-from"));
        b.classList.toggle("raffle-range-tab--active", f === part.from);
      });
    }
    raffleDetailState.rangeFrom = part.from;
    raffleDetailState.rangeTo = part.to;
    await loadRaffleTicketSlice();
  }

  function markActiveRangeTab(from) {
    var tabs = raffleDetailEl("tabs");
    if (!tabs) return;
    tabs.querySelectorAll(".raffle-range-tab").forEach(function (b) {
      var f = Number(b.getAttribute("data-from"));
      b.classList.toggle("raffle-range-tab--active", f === Number(from));
    });
  }

  async function setRaffleRange(from, to, scrollAnchor) {
    raffleDetailState.rangeFrom = Number(from);
    raffleDetailState.rangeTo = Number(to);
    markActiveRangeTab(from);
    await loadRaffleTicketSlice();
    var grid = raffleDetailEl("grid");
    if (!grid) return;
    if (scrollAnchor === "end") {
      grid.scrollTop = grid.scrollHeight;
    } else if (scrollAnchor === "start") {
      grid.scrollTop = 0;
    }
  }


  function renderRaffleGrid(cells) {
    var grid = raffleDetailEl("grid");
    if (!grid) return;
    var drawCells =
      IS_RAFFLE_PURCHASE_PAGE && raffleDetailState.onlyFreeView
        ? (cells || []).filter(function (c) {
            return String(c && c.kind) === "free";
          })
        : cells || [];
    var html = "";
    for (var i = 0; i < drawCells.length; i++) {
      var cell = drawCells[i];
      var n = cell.n;
      var kind = String(cell.kind || "free");
      /* Чужие занятые — серая точка без номера. Свои бронь / ожидание / подтверждено — оранжевые с номером. */
      if (kind === "taken") {
        html +=
          '<div class="raffle-cell raffle-cell--taken" title="Занято" aria-label="Занято"><span class="raffle-cell__dot"></span></div>';
        continue;
      }
      var label = String(n);
      var cls = "raffle-cell";
      if (kind === "self_reserved" || kind === "self_pending" || kind === "self_confirmed") {
        cls += " raffle-cell--free raffle-cell--mine";
        if (kind === "self_confirmed") cls += " raffle-cell--mine-confirmed";
        if (kind === "self_pending") cls += " raffle-cell--mine-pending";
        if (
          IS_RAFFLE_PURCHASE_PAGE &&
          kind === "self_reserved" &&
          raffleDetailState.selected &&
          raffleDetailState.selected.has(n)
        ) {
          cls += " raffle-cell--selected";
          html +=
            '<button type="button" class="' +
            cls +
            '" data-ticket="' +
            label +
            '" data-kind="self_reserved" aria-pressed="true">' +
            escapeHtml(label) +
            "</button>";
          continue;
        }
        html +=
          '<div class="' +
          cls +
          '" data-kind="' +
          escapeHtml(kind) +
          '" aria-label="Ваш номер ' +
          escapeHtml(label) +
          '"><span>' +
          escapeHtml(label) +
          "</span></div>";
        continue;
      }
      if (kind === "free") {
        cls += " raffle-cell--free";
        if (raffleDetailState.selected.has(n)) cls += " raffle-cell--selected";
        html +=
          '<button type="button" class="' +
          cls +
          '" data-ticket="' +
          label +
          '" data-kind="free" aria-pressed="' +
          String(raffleDetailState.selected.has(n)) +
          '">' +
          escapeHtml(label) +
          "</button>";
      } else {
        cls += " raffle-cell--free raffle-cell--mine";
        html +=
          '<div class="' +
          cls +
          '" data-kind="' +
          escapeHtml(kind) +
          '" aria-label="Номер ' +
          escapeHtml(label) +
          '"><span>' +
          escapeHtml(label) +
          "</span></div>";
      }
    }
    grid.innerHTML = html;
  }

  function syncVisibleGridCellSelectionState(ticketNumber) {
    var grid = raffleDetailEl("grid");
    if (!grid) return;
    var n = Number(ticketNumber);
    if (!Number.isFinite(n) || n < 1) return;
    var selector =
      'button[data-ticket="' +
      String(n) +
      '"][data-kind="free"],button[data-ticket="' +
      String(n) +
      '"][data-kind="self_reserved"]';
    var btn = grid.querySelector(selector);
    if (!btn) return;
    var isSelected = raffleDetailState.selected.has(n);
    btn.classList.toggle("raffle-cell--selected", isSelected);
    btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
  }

  function setRaffleGridLoading(loading) {
    var grid = raffleDetailEl("grid");
    if (!grid) return;
    var loader = grid.querySelector(".raffle-ticket-grid__loader");
    if (loading) {
      grid.classList.add("raffle-ticket-grid--loading");
      if (!loader) {
        loader = document.createElement("div");
        loader.className = "raffle-ticket-grid__loader";
        loader.setAttribute("aria-hidden", "true");
        loader.innerHTML =
          '<span class="raffle-ticket-grid__loader-ring"></span><span class="raffle-ticket-grid__loader-text">Загружаем номерки…</span>';
        grid.appendChild(loader);
      }
      return;
    }
    grid.classList.remove("raffle-ticket-grid--loading");
    if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
  }

  function getRaffleFastInputNumber() {
    var inp = document.getElementById("raffle-fast-number");
    if (!inp) return NaN;
    var digits = String(inp.value || "").replace(/\D/g, "");
    var n = parseInt(digits, 10);
    return Number.isFinite(n) ? n : NaN;
  }

  function renderRaffleFastInputState() {
    var stateEl = document.getElementById("raffle-fast-state");
    if (!stateEl) return;
    var n = getRaffleFastInputNumber();
    var r = raffleDetailState.raffle;
    if (!Number.isFinite(n) || n < 1 || !r || !r.id) {
      stateEl.innerHTML = "";
      return;
    }
    var maxN = Math.max(1, Math.floor(Number(r.ticket_count) || 1));
    if (n > maxN) {
      stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--invalid">Нет такого</span>';
      return;
    }
    var lk = raffleFastLookupState;
    if (!lk || lk.n !== n) {
      stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--loading">Проверяем…</span>';
      return;
    }
    var kind = String(lk.kind || "");
    if (kind === "free") {
      stateEl.innerHTML =
        '<div class="raffle-fast-input__ok"><span class="raffle-fast-input__free">Свободен</span><button type="button" class="raffle-fast-input__add" id="raffle-fast-add">В корзину</button></div>';
      return;
    }
    if (kind === "self_reserved" || kind === "self_pending" || kind === "self_confirmed") {
      stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--self">Ваш</span>';
      return;
    }
    if (kind === "taken") {
      stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--taken">Занят</span>';
      return;
    }
    if (kind === "error") {
      stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--invalid">Ошибка</span>';
      return;
    }
    stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--invalid">Нет такого</span>';
  }

  function scheduleRaffleFastInputLookup() {
    if (raffleFastLookupTimer) {
      clearTimeout(raffleFastLookupTimer);
      raffleFastLookupTimer = null;
    }
    var r = raffleDetailState.raffle;
    var n = getRaffleFastInputNumber();
    if (!r || !r.id || !Number.isFinite(n) || n < 1) {
      raffleFastLookupState = { n: NaN, kind: null };
      renderRaffleFastInputState();
      return;
    }
    var maxN = Math.max(1, Math.floor(Number(r.ticket_count) || 1));
    if (n > maxN) {
      raffleFastLookupState = { n: n, kind: "invalid" };
      renderRaffleFastInputState();
      return;
    }
    if (n >= Number(raffleDetailState.rangeFrom) && n <= Number(raffleDetailState.rangeTo)) {
      var localCells = Array.isArray(raffleDetailState.lastCells) ? raffleDetailState.lastCells : [];
      for (var ci = 0; ci < localCells.length; ci++) {
        var c = localCells[ci];
        if (Number(c && c.n) === n) {
          raffleFastLookupState = { n: n, kind: String(c.kind || "invalid") };
          renderRaffleFastInputState();
          return;
        }
      }
    }
    raffleFastLookupState = { n: n, kind: null };
    renderRaffleFastInputState();
    raffleFastLookupTimer = setTimeout(function () {
      var part = getRangeTabForTicketN(Number(r.ticket_count), n);
      if (!part) {
        raffleFastLookupState = { n: n, kind: "invalid" };
        renderRaffleFastInputState();
        return;
      }
      fetch(
        "/api/raffles/" + String(r.id) + "/tickets?from=" + String(part.from) + "&to=" + String(part.to),
        { cache: "no-store", headers: authHeaders() },
      )
        .then(function (res2) {
          return res2.json().then(function (d2) {
            return { ok: res2.ok, d: d2 };
          });
        })
        .then(function (x2) {
          var cur2 = getRaffleFastInputNumber();
          if (!Number.isFinite(cur2) || cur2 !== n) return;
          if (!x2.ok || !Array.isArray(x2.d && x2.d.cells)) {
            raffleFastLookupState = { n: n, kind: "invalid" };
            renderRaffleFastInputState();
            return;
          }
          var cells = x2.d.cells;
          var kind2 = null;
          for (var i2 = 0; i2 < cells.length; i2++) {
            if (Number(cells[i2] && cells[i2].n) === n) {
              kind2 = String(cells[i2].kind || "");
              break;
            }
          }
          raffleFastLookupState = { n: n, kind: kind2 || "invalid" };
          renderRaffleFastInputState();
        })
        .catch(function () {
          var cur3 = getRaffleFastInputNumber();
          if (!Number.isFinite(cur3) || cur3 !== n) return;
          raffleFastLookupState = { n: n, kind: "error" };
          renderRaffleFastInputState();
        });
    }, 300);
  }

  function addRaffleFastNumberToSelection(n) {
    if (!Number.isFinite(n) || n < 1) return;
    if (raffleDetailState.selected.has(n)) {
      showToast("Номер уже в корзине", "warning");
      return;
    }
    if (raffleDetailState.selected.size >= RAFFLE_MAX_SELECT) {
      showToast("Можно выбрать не более " + String(RAFFLE_MAX_SELECT) + " номерков", "warning");
      return;
    }
    raffleDetailState.selected.add(n);
    updateRaffleSelectionLabel();
    syncVisibleGridCellSelectionState(n);
    scheduleRaffleSelectionSync();
    showToast("Номер " + String(n) + " добавлен в корзину", "success");
    var inp = document.getElementById("raffle-fast-number");
    if (inp) inp.value = "";
    raffleFastLookupState = { n: NaN, kind: null };
    renderRaffleFastInputState();
  }

  function pickRandomFreeFromCurrentRange() {
    var cells = Array.isArray(raffleDetailState.lastCells) ? raffleDetailState.lastCells : [];
    var free = cells
      .filter(function (c) {
        return c && String(c.kind) === "free" && Number.isFinite(Number(c.n));
      })
      .map(function (c) {
        return Number(c.n);
      })
      .filter(function (n) {
        return !raffleDetailState.selected.has(n);
      });
    if (!free.length) {
      showToast("Свободных номерков в этой таблице нет", "warning");
      return;
    }
    var rnd = free[Math.floor(Math.random() * free.length)];
    var inp = document.getElementById("raffle-fast-number");
    if (inp) inp.value = String(rnd);
    raffleFastLookupState = { n: rnd, kind: "free" };
    renderRaffleFastInputState();
  }

  function buildRaffleRangeTabs(ticketCount) {
    var tabs = raffleDetailEl("tabs");
    if (!tabs) return;
    var maxN = Math.max(1, Math.floor(Number(ticketCount) || 1));
    var chunk = 500;
    var parts = [];
    var start = 1;
    while (start <= maxN) {
      var end = Math.min(start + chunk - 1, maxN);
      parts.push({ from: start, to: end });
      start = end + 1;
    }
    raffleDetailState.rangeParts = parts.slice();
    tabs.innerHTML = parts
      .map(function (p, idx) {
        var label = String(p.from) + "–" + String(p.to);
        return (
          '<button type="button" role="tab" class="raffle-range-tab' +
          (idx === 0 ? " raffle-range-tab--active" : "") +
          '" data-from="' +
          String(p.from) +
          '" data-to="' +
          String(p.to) +
          '">' +
          escapeHtml(label) +
          "</button>"
        );
      })
      .join("");
    tabs.querySelectorAll(".raffle-range-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var from = Number(btn.getAttribute("data-from"));
        var to = Number(btn.getAttribute("data-to"));
        setRaffleRange(from, to, "start").catch(function (e) {
          showToast(String(e.message || "Ошибка"), "error");
        });
      });
    });
    if (parts.length) {
      raffleDetailState.rangeFrom = parts[0].from;
      raffleDetailState.rangeTo = parts[0].to;
    }
  }

  async function syncRaffleOrderAndUi() {
    var r = raffleDetailState.raffle;
    if (!r || !r.id) return;
    var id = Number(r.id);
    var res = await fetch("/api/raffles/" + String(id) + "/order", {
      cache: "no-store",
      headers: authHeaders(),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || "Ошибка");
    applyRaffleServerTimeSkewFromPayload(data);
    raffleDetailState.order = data.order || null;
    raffleDetailState.orderNumbers = Array.isArray(data.numbers) ? data.numbers : [];
    if (!raffleDetailState.order || String(raffleDetailState.order.status || "") !== "reserved") {
      clearRaffleReservationCountdownAnchor();
    }
    if (IS_RAFFLE_PURCHASE_PAGE) {
      restoreRaffleDraftSelectionFromStorage();
      for (var si = 0; si < raffleDetailState.orderNumbers.length; si++) {
        if (raffleDetailState.selected.size >= RAFFLE_MAX_SELECT) break;
        raffleDetailState.selected.add(raffleDetailState.orderNumbers[si]);
      }
      raffleDraftHydrated = true;
      persistRaffleDraftSelection();
      updateRaffleSelectionLabel();
    }
    var order = raffleDetailState.order;
    var timerEl = raffleDetailEl("timer");
    if (timerEl) timerEl.hidden = true;
    clearRaffleDetailTimer();
    if (!order) {
      setRaffleDetailSteps("grid");
      if (timerEl) timerEl.hidden = true;
      updateRafflePurchaseChrome();
      return;
    }
    var st = String(order.status || "");
    if (IS_RAFFLE_PURCHASE_PAGE && (st === "reserved" || st === "pending_review")) {
      setRaffleDetailSteps("grid");
      if (timerEl) timerEl.hidden = true;
      updateRafflePurchaseChrome();
      return;
    }
    if (st === "pending_review") {
      setRaffleDetailSteps("wait");
      if (timerEl) timerEl.hidden = true;
      updateRafflePurchaseChrome();
      return;
    }
    if (st === "reserved") {
      syncRafflePaymentButtons(r);
      var payAvail = getRafflePaymentAvailability(r);
      var bank = order.bank ? String(order.bank) : "";
      var until = Number(order.reserved_until || 0);
      try {
        var smKey = "ab_sber_pay_" + String(order.id);
        var sv = sessionStorage.getItem(smKey);
        if (sv === "collection" || sv === "qr") raffleDetailState.sberMethod = sv;
      } catch (_) {}
      if (until > 0 && getRaffleReservationLeftMs(until) > 0) {
        startRaffleReserveTimer(until);
      } else {
        var checkoutTimerText = document.getElementById("raffle-page-checkout-timer-text");
        if (checkoutTimerText) checkoutTimerText.textContent = "Бронь истекла";
        if (timerEl) timerEl.hidden = true;
      }
      if (!bank) {
        setRaffleDetailSteps("bank");
      } else if (bank === "sber" && !raffleDetailState.sberMethod) {
        if (payAvail.hasCollection && !payAvail.hasQr) {
          raffleDetailState.sberMethod = "collection";
          renderRafflePayBody(r, "sber", "collection");
          setRaffleDetailSteps("pay");
        } else if (!payAvail.hasCollection && payAvail.hasQr) {
          raffleDetailState.sberMethod = "qr";
          renderRafflePayBody(r, "sber", "qr");
          setRaffleDetailSteps("pay");
        } else {
          setRaffleDetailSteps("sber-method");
        }
      } else {
        if (bank === "other" && !payAvail.hasQr) {
          raffleDetailState.order.bank = null;
          raffleDetailState.sberMethod = null;
          setRaffleDetailSteps("bank");
          updateRafflePurchaseChrome();
          return;
        }
        if (bank === "sber") {
          var savedMethod = String(raffleDetailState.sberMethod || "");
          if (savedMethod === "collection" && !payAvail.hasCollection) {
            raffleDetailState.sberMethod = payAvail.hasQr ? "qr" : null;
          } else if (savedMethod === "qr" && !payAvail.hasQr) {
            raffleDetailState.sberMethod = payAvail.hasCollection ? "collection" : null;
          }
        }
        setRaffleDetailSteps("pay");
        var sm = bank === "sber" ? raffleDetailState.sberMethod || (payAvail.hasCollection ? "collection" : "qr") : null;
        renderRafflePayBody(r, bank === "sber" ? "sber" : "other", sm);
      }
      updateRafflePurchaseChrome();
      return;
    }
    setRaffleDetailSteps("grid");
    updateRafflePurchaseChrome();
  }

  async function selectBestRangeByFreeCount() {
    var r = raffleDetailState.raffle;
    if (!r || !r.id) return;
    var parts = raffleDetailState.rangeParts || [];
    if (parts.length < 2) return;
    var rid = Number(r.id);
    var requests = parts.map(function (p) {
      return fetch(
        "/api/raffles/" + String(rid) + "/tickets?from=" + String(p.from) + "&to=" + String(p.to),
        { cache: "no-store", headers: authHeaders() },
      )
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d: d };
          });
        })
        .then(function (x) {
          if (!x.ok) return -1;
          var cells = x.d && Array.isArray(x.d.cells) ? x.d.cells : [];
          var free = 0;
          for (var i = 0; i < cells.length; i++) {
            if (String(cells[i].kind) === "free") free++;
          }
          return free;
        })
        .catch(function () {
          return -1;
        });
    });
    var counts = await Promise.all(requests);
    var bestIdx = 0;
    var bestFree = counts[0] == null ? -1 : counts[0];
    for (var j = 1; j < counts.length; j++) {
      if (counts[j] > bestFree) {
        bestFree = counts[j];
        bestIdx = j;
      }
    }
    var best = parts[bestIdx];
    if (!best) return;
    raffleDetailState.rangeFrom = Number(best.from);
    raffleDetailState.rangeTo = Number(best.to);
    markActiveRangeTab(best.from);
  }

  function openRaffleUnavailableModal(r) {
    if (!modalRaffleUnavailable) return;
    var st = String(r.status || "active");
    var inner = document.getElementById("modal-raffle-unavailable-inner");
    if (inner) {
      inner.classList.toggle("raffle-unavailable--paused", st === "paused");
      inner.classList.toggle("raffle-unavailable--closed", st === "closed");
    }
    var icP = modalRaffleUnavailable.querySelector(".raffle-unavailable__icon--paused");
    var icC = modalRaffleUnavailable.querySelector(".raffle-unavailable__icon--closed");
    if (icP) icP.hidden = st !== "paused";
    if (icC) icC.hidden = st !== "closed";
    var heading = document.getElementById("raffle-unavailable-heading");
    var text = document.getElementById("raffle-unavailable-text");
    if (heading) heading.textContent = String(r.title || "");
    if (text) {
      text.textContent =
        st === "paused"
          ? "Техническая пауза. Продажи временно недоступны. Скоро вернёмся."
          : "Продажи закрыты: все номерки распроданы. Скоро назначим прямой эфир для награждения победителей — следите за новостями в чате и на сайте.";
    }
    openModal(modalRaffleUnavailable);
  }

  function bindRafflePurchasePageEvents() {
    if (window.__abRafflePageBound) return;
    window.__abRafflePageBound = true;

    document.getElementById("raffle-page-back")?.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      location.href = "/home";
    });

    document.getElementById("raffle-pay-numbers")?.addEventListener("click", function (e) {
      var rm = e.target.closest("[data-raffle-pay-remove]");
      if (!rm) return;
      e.preventDefault();
      var orderIdR = Number(rm.getAttribute("data-order-id"));
      var ticketR = Number(rm.getAttribute("data-ticket"));
      if (!Number.isFinite(orderIdR) || !Number.isFinite(ticketR)) return;
      fetch("/api/raffles/orders/" + String(orderIdR) + "/tickets/" + String(ticketR), {
        method: "DELETE",
        headers: authHeaders(),
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d: d };
          });
        })
        .then(function (x) {
          if (!x.ok) throw new Error(x.d.error || "Ошибка");
          return syncRaffleOrderAndUi();
        })
        .catch(function (err) {
          showToast(String(err.message || "Ошибка"), "error");
        });
    });

    document.getElementById("raffle-page-grid")?.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-ticket]");
      if (!btn) return;
      if (isRaffleLockedByReceiptPending()) {
        openWaitReceiptModal();
        return;
      }
      var kind = btn.getAttribute("data-kind");
      if (kind !== "free" && kind !== "self_reserved") return;
      var n = Number(btn.getAttribute("data-ticket"));
      if (!Number.isFinite(n) || n < 1) return;
      if (raffleDetailState.selected.has(n)) raffleDetailState.selected.delete(n);
      else {
        if (raffleDetailState.selected.size >= RAFFLE_MAX_SELECT) {
          showToast("Можно выбрать не более " + String(RAFFLE_MAX_SELECT) + " номерков", "warning");
          return;
        }
        raffleDetailState.selected.add(n);
      }
      updateRaffleSelectionLabel();
      syncVisibleGridCellSelectionState(n);
      scheduleRaffleSelectionSync();
    });

    document.getElementById("raffle-fast-number")?.addEventListener("input", function () {
      scheduleRaffleFastInputLookup();
    });
    document.getElementById("raffle-fast-number")?.addEventListener("focus", function () {
      document.documentElement.classList.add("bottom-nav-hidden-by-fast-input");
    });
    document.getElementById("raffle-fast-number")?.addEventListener("blur", function () {
      setTimeout(function () {
        var active = document.activeElement;
        if (active && active.id === "raffle-fast-number") return;
        document.documentElement.classList.remove("bottom-nav-hidden-by-fast-input");
      }, 40);
    });
    document.getElementById("raffle-fast-random")?.addEventListener("click", function () {
      pickRandomFreeFromCurrentRange();
    });
    document.getElementById("raffle-fast-input")?.addEventListener("click", function (e) {
      var addBtn = e.target.closest("#raffle-fast-add");
      if (!addBtn) return;
      var n = getRaffleFastInputNumber();
      if (!Number.isFinite(n) || n < 1) return;
      addRaffleFastNumberToSelection(n);
    });

    document.getElementById("raffle-page-only-free")?.addEventListener("click", function () {
      raffleDetailState.onlyFreeView = !raffleDetailState.onlyFreeView;
      this.setAttribute("aria-pressed", raffleDetailState.onlyFreeView ? "true" : "false");
      this.classList.toggle("raffle-range-eye--active", raffleDetailState.onlyFreeView);
      renderRaffleGrid(raffleDetailState.lastCells || []);
    });

    document.getElementById("raffle-page-reserve")?.addEventListener("click", async function () {
      emitUxEvent("raffle_cart_open_requested", {
        selected: raffleDetailState.selected ? raffleDetailState.selected.size : 0,
      });
      location.href = "/home?openCart=1";
    });

    document.querySelectorAll("#raffle-page-flow [data-raffle-bank]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var bank = btn.getAttribute("data-raffle-bank");
        var o = raffleDetailState.order;
        var r = raffleDetailState.raffle;
        var payAvail = getRafflePaymentAvailability(r || {});
        if (!o || !o.id) return;
        if (bank === "other" && !payAvail.hasQr) {
          showToast("Этот способ оплаты сейчас недоступен", "error");
          return;
        }
        if (bank === "sber" && !payAvail.hasAny) {
          showToast("Способы оплаты не настроены для этой акции", "error");
          return;
        }
        try {
          var res = await fetch("/api/raffles/orders/" + String(o.id) + "/bank", {
            method: "PATCH",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ bank: bank }),
          });
          var data = await res.json().catch(function () {
            return {};
          });
          if (!res.ok) throw new Error(data.error || "Ошибка");
          applyRaffleServerTimeSkewFromPayload(data);
          raffleDetailState.order = data.order;
          syncRafflePaymentButtons(r || {});
          if (bank === "sber") {
            if (payAvail.hasCollection && !payAvail.hasQr) {
              raffleDetailState.sberMethod = "collection";
              if (r) renderRafflePayBody(r, "sber", "collection");
              setRaffleDetailSteps("pay");
            } else if (!payAvail.hasCollection && payAvail.hasQr) {
              raffleDetailState.sberMethod = "qr";
              if (r) renderRafflePayBody(r, "sber", "qr");
              setRaffleDetailSteps("pay");
            } else {
              raffleDetailState.sberMethod = null;
              setRaffleDetailSteps("sber-method");
            }
          } else {
            raffleDetailState.sberMethod = null;
            if (r) renderRafflePayBody(r, "other", null);
            setRaffleDetailSteps("pay");
          }
        } catch (e) {
          showToast(String(e.message || "Ошибка"), "error");
        }
      });
    });

    document.querySelectorAll("#raffle-page-flow [data-sber-method]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var method = btn.getAttribute("data-sber-method");
        var o = raffleDetailState.order;
        var r = raffleDetailState.raffle;
        if (!o || !o.id || !r || (method !== "collection" && method !== "qr")) return;
        raffleDetailState.sberMethod = method;
        try {
          sessionStorage.setItem("ab_sber_pay_" + String(o.id), method);
        } catch (_) {}
        renderRafflePayBody(r, "sber", method);
        setRaffleDetailSteps("pay");
      });
    });

    document.getElementById("raffle-page-extend")?.addEventListener("click", function () {
      showToast("Дополнительное время недоступно", "warning");
    });

    document.getElementById("raffle-page-paid")?.addEventListener("click", function () {
      var o = raffleDetailState.order;
      if (!o || !o.id) return;
      location.href = "/home/raffle/confirm?orderId=" + encodeURIComponent(String(o.id));
    });
    document.getElementById("raffle-page-step-pay")?.addEventListener("click", function (e) {
      var btn = e.target.closest("#raffle-pay-support");
      if (!btn) return;
      var orderId = Number(btn.getAttribute("data-order-id"));
      var amount = Number(btn.getAttribute("data-amount"));
      openChatPanel();
      setTimeout(function () {
        var input = document.getElementById("chat-input");
        if (!input) return;
        input.value =
          "Проблема с оплатой. Заказ: " +
          (orderId > 0 ? "A" + String(orderId) : "—") +
          ", сумма: " +
          formatRubleAmount(amount) +
          " ₽.";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, 120);
    });
  }

  async function initRafflePurchasePage() {
    if (!IS_RAFFLE_PURCHASE_PAGE) return;
    raffleDetailState.elPrefix = "raffle-page";
    try {
      document.documentElement.classList.add("raffle-purchase-page");
    } catch (_) {}
    var params = new URLSearchParams(location.search);
    var id = Number(params.get("id"));
    if (!Number.isFinite(id) || id < 1) {
      location.replace("/home");
      return;
    }
    clearRaffleDetailTimer();
    stopRafflePageViewersAutoRefresh();
    resetRaffleDetailSelection();
    raffleDetailState.order = null;
    raffleDetailState.orderNumbers = [];
    raffleDetailState.sberMethod = null;
    try {
      var res = await fetch("/api/raffles/" + String(id), {
        cache: "no-store",
        headers: authHeaders(),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "Ошибка");
      var r = data.raffle;
      if (!r || String(r.status) !== "active") {
        location.replace("/home");
        return;
      }
      raffleDetailState.raffle = r;
      startRaffleViewHeartbeat(Number(r.id));
      syncRafflePaymentButtons(r);
      var heading = raffleDetailEl("heading");
      var priceBadge = document.getElementById("raffle-page-price-badge");
      if (heading) heading.textContent = String(r.title || "");
      if (priceBadge) {
        var pr = Number(r.price_rub ?? 0);
        var fmt = formatRubleAmount(pr);
        priceBadge.classList.remove("raffle-price-badge--hero-sale");
        priceBadge.textContent = "БИЛЕТ: " + fmt + " ₽";
        priceBadge.hidden = false;
      }
      var viewersEl = document.getElementById("raffle-page-viewers");
      var viewersTextEl = document.getElementById("raffle-page-viewers-text");
      if (viewersEl && viewersTextEl) {
        var viewersCount = Math.max(0, Number(r.viewers_count) || 0);
        viewersTextEl.textContent = "Онлайн: " + String(viewersCount);
        viewersEl.hidden = viewersCount <= 0;
      }
      startRafflePageViewersAutoRefresh(Number(r.id));
      buildRaffleRangeTabs(r.ticket_count);
      await selectBestRangeByFreeCount();
      updateRaffleSelectionLabel();
      await syncRaffleOrderAndUi();
      await loadRaffleTicketSlice();
      bindRafflePurchasePageEvents();
      renderRaffleFastInputState();
      if (isRaffleLockedByReceiptPending()) {
        openWaitReceiptModal();
      }
      setBottomNavActive();
    } catch (e) {
      showToast(String(e.message || "Ошибка"), "error");
      location.replace("/home");
    }
  }

  async function initRafflePayPage() {
    if (!IS_RAFFLE_PAY_PAGE) return;
    raffleDetailState.elPrefix = "raffle-page";
    try {
      document.documentElement.classList.add("raffle-purchase-page");
    } catch (_) {}
    var params = new URLSearchParams(location.search);
    var id = Number(params.get("id"));
    if (!Number.isFinite(id) || id < 1) {
      location.replace("/home");
      return;
    }
    clearRaffleDetailTimer();
    resetRaffleDetailSelection();
    raffleDetailState.order = null;
    raffleDetailState.orderNumbers = [];
    raffleDetailState.sberMethod = null;
    try {
      var res = await fetch("/api/raffles/" + String(id), {
        cache: "no-store",
        headers: authHeaders(),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "Ошибка");
      var r = data.raffle;
      if (!r || String(r.status) !== "active") {
        location.replace("/home");
        return;
      }
      raffleDetailState.raffle = r;
      startRaffleViewHeartbeat(Number(r.id));
      await syncRaffleOrderAndUi();
      var o = raffleDetailState.order;
      if (!o) {
        location.replace("/home/raffle?id=" + encodeURIComponent(String(id)));
        return;
      }
      var st = String(o.status || "");
      if (st === "pending_review") {
        bindRafflePurchasePageEvents();
        return;
      }
      if (st !== "reserved") {
        location.replace("/home");
        return;
      }
      bindRafflePurchasePageEvents();
    } catch (e) {
      showToast(String(e.message || "Ошибка"), "error");
      location.replace("/home");
    }
  }

  var raffleConfirmCtx = { orderId: 0, raffleId: null };

  function initRaffleConfirmPage() {
    if (!IS_RAFFLE_CONFIRM_PAGE) return Promise.resolve();
    try {
      document.documentElement.classList.add("raffle-confirm-page");
    } catch (_) {}
    var params = new URLSearchParams(location.search);
    var orderId = Number(params.get("orderId"));
    if (!Number.isFinite(orderId) || orderId < 1) {
      location.replace("/home");
      return Promise.resolve();
    }
    raffleConfirmCtx.orderId = orderId;
    return fetch("/api/raffles/orders/" + String(orderId), {
      cache: "no-store",
      headers: authHeaders(),
    })
      .then(function (res) {
        return res.json().then(function (d) {
          return { ok: res.ok, d: d };
        });
      })
      .then(function (x) {
        if (!x.ok || !x.d.order) throw new Error(x.d.error || "Ошибка");
        applyRaffleServerTimeSkewFromPayload(x.d);
        var o = x.d.order;
        if (String(o.status) !== "reserved") {
          location.replace("/home");
          return;
        }
        var nums = x.d.numbers || [];
        var r = x.d.raffle;
        raffleConfirmCtx.raffleId = r && r.id != null ? Number(r.id) : null;
        var lead = document.getElementById("raffle-confirm-lead");
        if (lead && r) {
          lead.textContent =
            String(r.title || "") +
            " · " +
            nums
              .map(function (n) {
                return "№ " + String(n);
              })
              .join(", ") +
            " · к оплате " +
            formatRubleAmount(Number(o.amount_rub ?? 0)) +
            " ₽";
        }
      })
      .catch(function () {
        location.replace("/home");
      });
  }

  document.getElementById("raffle-confirm-back")?.addEventListener("click", function () {
    if (raffleConfirmCtx.raffleId != null) {
      location.href = "/home/raffle/pay?id=" + encodeURIComponent(String(raffleConfirmCtx.raffleId));
    } else {
      history.back();
    }
  });

  document.getElementById("raffle-confirm-file")?.addEventListener("change", function () {
    var f = this.files && this.files[0];
    var el = document.getElementById("raffle-confirm-file-name");
    if (el) el.textContent = f ? f.name : "";
  });

  document.getElementById("raffle-confirm-send")?.addEventListener("click", async function () {
    var input = document.getElementById("raffle-confirm-file");
    var file = input && input.files && input.files[0];
    var oid = raffleConfirmCtx.orderId;
    if (!file) {
      showToast("Выберите файл чека", "warning");
      return;
    }
    if (!oid) return;
    try {
      var fd = new FormData();
      fd.append("file", file);
      var up = await fetch("/api/raffles/receipt-upload", {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      if (up.status === 401) throw new Error("SESSION_EXPIRED");
      var uploadData = await up.json().catch(function () {
        return {};
      });
      if (!up.ok) throw new Error(uploadData.error || "Ошибка загрузки");
      var res = await fetch("/api/raffles/orders/" + String(oid) + "/receipt", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          url: uploadData.url,
          name: uploadData.name,
          mime: uploadData.mime,
          sha256: uploadData.sha256,
        }),
      });
      if (res.status === 401) throw new Error("SESSION_EXPIRED");
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "Ошибка");
      var etaC =
        data.order && data.order.receipt_review_eta_hint
          ? String(data.order.receipt_review_eta_hint)
          : "";
      try {
        sessionStorage.setItem(
          "ab_pending_toast",
          JSON.stringify({
            message: etaC
              ? "Чек принят на проверку. " + etaC
              : "Ожидайте проверки от администратора",
            type: "neutral",
          }),
        );
      } catch (_) {}
      location.href = "/home";
    } catch (e) {
      var msg = String((e && e.message) || "Ошибка");
      if (msg === "SESSION_EXPIRED") {
        showActionErrorModal("Сессия истекла", "Войдите снова и повторите отправку чека.", function () {
          openModal(modalLogin);
        });
      } else {
        showActionErrorModal("Не удалось загрузить чек", msg, function () {
          document.getElementById("raffle-confirm-send")?.click();
        });
      }
    }
  });

  document.getElementById("modal-raffle-unavailable-close")?.addEventListener("click", function () {
    closeRaffleUnavailableModal();
  });
  modalRaffleUnavailable?.addEventListener("click", function (e) {
    if (e.target === modalRaffleUnavailable) closeRaffleUnavailableModal();
  });

  document.getElementById("reserve-success-go-pay")?.addEventListener("click", function () {
    if (!reserveFlowState.orderId) return;
    fetch("/api/raffles/orders/" + String(reserveFlowState.orderId) + "/bank", {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ bank: "sber" }),
    }).catch(function () {});
    if (modalReserveSuccess) closeModal(modalReserveSuccess);
    if (modalReservePayment) openModal(modalReservePayment);
    try {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(function () {});
      }
    } catch (_) {}
    switchReservePaymentStep("requisites");
    startReservePaymentTimer(reserveFlowState.reservedUntil);
    emitUxEvent("raffle_payment_opened", { order_id: reserveFlowState.orderId });
  });
  modalReserveSuccess?.addEventListener("click", function (e) {
    if (e.target === modalReserveSuccess) closeModal(modalReserveSuccess);
  });

  document.getElementById("reserve-payment-close")?.addEventListener("click", function () {
    closeReservePaymentModal();
  });
  modalReservePayment?.addEventListener("click", function (e) {
    if (e.target === modalReservePayment) closeReservePaymentModal();
  });
  document.getElementById("reserve-payment-done")?.addEventListener("click", function () {
    switchReservePaymentStep("confirm");
    emitUxEvent("raffle_payment_marked_done", { order_id: reserveFlowState.orderId });
  });
  document.getElementById("reserve-payment-link")?.addEventListener("click", function (e) {
    if (this.getAttribute("aria-disabled") === "true") {
      e.preventDefault();
      showToast("Реквизиты пока не настроены", "warning");
    }
  });
  document.getElementById("reserve-payment-link-tbank")?.addEventListener("click", function (e) {
    if (this.getAttribute("aria-disabled") === "true") {
      e.preventDefault();
      showToast("Реквизиты пока не настроены", "warning");
    }
  });
  document.getElementById("reserve-payment-method-collection")?.addEventListener("click", function () {
    reserveFlowState.paymentMethod = "collection";
    renderReserveFlowModals();
  });
  document.getElementById("reserve-payment-method-tbank")?.addEventListener("click", function () {
    reserveFlowState.paymentMethod = "tbank_collection";
    renderReserveFlowModals();
  });
  document.getElementById("reserve-payment-method-qr")?.addEventListener("click", function () {
    reserveFlowState.paymentMethod = "qr";
    renderReserveFlowModals();
  });
  document.getElementById("reserve-payment-back")?.addEventListener("click", function () {
    switchReservePaymentStep("requisites");
  });
  document.getElementById("reserve-payment-back-link")?.addEventListener("click", function () {
    switchReservePaymentStep("requisites");
  });
  document.getElementById("reserve-payment-support")?.addEventListener("click", function () {
    openChatPanel();
    setTimeout(function () {
      var input = document.getElementById("chat-input");
      if (!input) return;
      input.value =
        "Проблема с оплатой. Заказ: " +
        (reserveFlowState.orderId > 0 ? "A" + String(reserveFlowState.orderId) : "—") +
        ", сумма: " +
        formatRubleAmount(Number(reserveFlowState.amountRub || 0)) +
        " ₽.";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, 120);
  });
  document.getElementById("reserve-payment-file")?.addEventListener("change", function () {
    var f = this.files && this.files[0];
    var nameEl = document.getElementById("reserve-payment-file-name");
    if (nameEl) nameEl.textContent = f ? f.name : "Фото или PDF перевода";
  });
  document.getElementById("reserve-payment-send")?.addEventListener("click", async function () {
    var input = document.getElementById("reserve-payment-file");
    var file = input && input.files && input.files[0];
    if (!file) {
      showToast("Выберите файл чека", "warning");
      return;
    }
    if (!reserveFlowState.orderId) return;
    try {
      var fd = new FormData();
      fd.append("file", file);
      var up = await fetch("/api/raffles/receipt-upload", {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      if (up.status === 401) throw new Error("SESSION_EXPIRED");
      var uploadData = await up.json().catch(function () {
        return {};
      });
      if (!up.ok) throw new Error(uploadData.error || "Ошибка загрузки");
      var res = await fetch("/api/raffles/orders/" + String(reserveFlowState.orderId) + "/receipt", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          url: uploadData.url,
          name: uploadData.name,
          mime: uploadData.mime,
          sha256: uploadData.sha256,
        }),
      });
      if (res.status === 401) throw new Error("SESSION_EXPIRED");
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "Ошибка");
      applyRaffleServerTimeSkewFromPayload(data);
      closeReservePaymentModal();
      if (modalWaitReceipt) closeModal(modalWaitReceipt);
      raffleDetailState.order = null;
      raffleDetailState.orderNumbers = [];
      resetRaffleDetailSelection();
      persistRaffleDraftSelection();
      updateRaffleSelectionLabel();
      raffleDataCache.cart = { items: [] };
      applyCartBadgeFromItems([]);
      if (modalCart && modalCart.classList.contains("is-open")) {
        renderCartModalBody([]);
      }
      fetchCartFromApi().catch(function () {});
      fetchTicketsFromApi().catch(function () {});
      loadRaffleTicketSlice().catch(function () {});
      var etaHint =
        data.order && data.order.receipt_review_eta_hint
          ? String(data.order.receipt_review_eta_hint)
          : "";
      showToast(etaHint ? "Чек отправлен. " + etaHint : "Чек отправлен на проверку", "success");
      emitUxEvent("raffle_receipt_sent", { order_id: reserveFlowState.orderId });
    } catch (err) {
      var msg = String((err && err.message) || "Ошибка");
      if (msg === "SESSION_EXPIRED") {
        showActionErrorModal(
          "Сессия истекла",
          "Войдите снова и повторите отправку чека.",
          function () {
            openModal(modalLogin);
          },
        );
        return;
      }
      showActionErrorModal(
        "Не удалось загрузить чек",
        msg || "Проверьте соединение и повторите.",
        function () {
          document.getElementById("reserve-payment-send")?.click();
        },
      );
    }
  });

  document.getElementById("wait-receipt-upload")?.addEventListener("click", function () {
    /* Сначала шаг «чек» в скрытой модалке оплаты — иначе openModal успевает сфокусировать элементы шага 2.
       Закрытие «нужен чек» и открытие оплаты разводим по кадрам: на части WebKit тап теряется при смене оверлея в том же таске. */
    switchReservePaymentStep("confirm");
    if (modalWaitReceipt) closeModal(modalWaitReceipt);
    var until = reserveFlowState.reservedUntil;
    requestAnimationFrame(function () {
      if (modalReservePayment) openModal(modalReservePayment);
      startReservePaymentTimer(until);
    });
  });
  document.getElementById("reserve-expired-close")?.addEventListener("click", function () {
    if (modalReserveExpired) closeModal(modalReserveExpired);
  });
  modalReserveExpired?.addEventListener("click", function (e) {
    if (e.target === modalReserveExpired) closeModal(modalReserveExpired);
  });
  document.getElementById("action-error-retry")?.addEventListener("click", function () {
    if (modalActionError) closeModal(modalActionError);
    if (typeof lastActionErrorRetry === "function") {
      var fn = lastActionErrorRetry;
      lastActionErrorRetry = null;
      fn();
    }
  });
  modalActionError?.addEventListener("click", function (e) {
    if (e.target === modalActionError) closeModal(modalActionError);
  });

  document.getElementById("modal-cart-close")?.addEventListener("click", function () {
    closeCartModal();
  });
  modalCart?.addEventListener("click", function (e) {
    if (e.target === modalCart) {
      closeCartModal();
      return;
    }
    var addMore = e.target.closest("[data-cart-add-more]");
    if (addMore) {
      e.preventDefault();
      closeCartModal();
      if (IS_RAFFLE_PURCHASE_PAGE) {
        setTimeout(function () {
          openTicketSearchModal();
        }, 120);
      }
      return;
    }
    var rm = e.target.closest("[data-cart-remove]");
    var rmDraft = e.target.closest("[data-cart-draft-remove]");
    if (!rm && !rmDraft) return;
    e.preventDefault();
    var nowRm = Date.now();
    if (nowRm - lastCartRemoveAt < 450) return;
    lastCartRemoveAt = nowRm;
    if (rmDraft) {
      var ticketD = Number(rmDraft.getAttribute("data-ticket"));
      if (!Number.isFinite(ticketD)) return;
      raffleDetailState.selected.delete(ticketD);
      updateRaffleSelectionLabel();
      scheduleRaffleSelectionSync();
      if (modalCart && modalCart.classList.contains("is-open")) {
        renderCartModalBody(raffleDataCache.cart ? raffleDataCache.cart.items : []);
      }
      if (IS_RAFFLE_PURCHASE_PAGE) {
        loadRaffleTicketSlice().catch(function () {});
      }
      return;
    }
    var orderId = Number(rm.getAttribute("data-order-id"));
    var ticket = Number(rm.getAttribute("data-ticket"));
    if (!Number.isFinite(orderId) || !Number.isFinite(ticket)) return;
    rm.disabled = true;
    fetch("/api/raffles/orders/" + String(orderId) + "/tickets/" + String(ticket), {
      method: "DELETE",
      headers: authHeaders(),
    })
      .then(function (res) {
        return res.json().then(function (d) {
          return { ok: res.ok, d: d };
        });
      })
      .then(function (x) {
        if (!x.ok) throw new Error(x.d.error || "Ошибка");
        return Promise.all([fetchCartFromApi(), fetchTicketsFromApi().catch(function () {})]);
      })
      .then(function () {
        if (modalCart && modalCart.classList.contains("is-open")) {
          renderCartModalBody(raffleDataCache.cart ? raffleDataCache.cart.items : []);
        }
        if (modalTickets && modalTickets.classList.contains("is-open")) {
          renderTicketsModalBody(
            raffleDataCache.tickets || { reserved: [], pending_review: [], confirmed: [] },
          );
        }
      })
      .catch(function (err) {
        showToast(String(err.message || "Ошибка"), "error");
      })
      .finally(function () {
        if (rm) rm.disabled = false;
      });
  });
  document.getElementById("modal-cart-checkout")?.addEventListener("click", function () {
    var btn = this;
    var rid = btn.getAttribute("data-checkout-raffle-id");
    if (!rid || btn.classList.contains("cart-sheet__cta--loading")) return;
    var now = Date.now();
    if (now - lastCartCheckoutAt < 2000) return;
    lastCartCheckoutAt = now;
    setCartCheckoutLoading(true);
    var raffleId = Number(rid);
    var runClassicRedirect = !IS_RAFFLE_PURCHASE_PAGE;
    if (runClassicRedirect) {
      window.setTimeout(function () {
        closeCartModal();
        location.href = "/home/raffle/pay?id=" + encodeURIComponent(rid);
      }, 160);
      return;
    }
    var nums = Array.from(raffleDetailState.selected || []).sort(function (a, b) {
      return a - b;
    });
    emitUxEvent("raffle_checkout_clicked", { draft_tickets: nums.length });
    var order = raffleDetailState.order;
    var raffle = getCachedRaffleById(raffleId);
    var hasReservedOrder = !!(order && String(order.status || "") === "reserved" && Number(order.id) > 0);
    var reserveReq = null;
    if (hasReservedOrder) {
      reserveReq = Promise.resolve({ order: order, numbers: raffleDetailState.orderNumbers || [] });
    } else {
      if (!Number.isFinite(raffleId) || raffleId < 1 || !nums.length) {
        setCartCheckoutLoading(false);
        return;
      }
      reserveReq = apiJson("/api/raffles/" + String(raffleId) + "/reserve", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ numbers: nums }),
      });
    }
    reserveReq
      .then(function (data) {
        applyRaffleServerTimeSkewFromPayload(data);
        raffleDetailState.order = data && data.order ? data.order : null;
        raffleDetailState.orderNumbers = data && Array.isArray(data.numbers) ? data.numbers : [];
        var ord = raffleDetailState.order;
        if (!ord || Number(ord.id) < 1) throw new Error("Не удалось создать бронь");
        raffleDetailState.selected.clear();
        persistRaffleDraftSelection();
        closeCartModal();
        setCartCheckoutLoading(false);
        openReserveSuccessFlow(ord, raffleDetailState.orderNumbers, raffle);
        var released = data && Array.isArray(data.released_after_cleanup) ? data.released_after_cleanup : [];
        var skipped = data && Array.isArray(data.skipped_still_occupied) ? data.skipped_still_occupied : [];
        if (released.length || skipped.length) {
          var fmt = function (arr) {
            return arr
              .map(function (x) {
                return "№" + String(x);
              })
              .join(", ");
          };
          var parts = [];
          if (released.length) {
            parts.push(
              released.length === 1
                ? "Номерок " + fmt(released) + ": у прежнего участника истекла бронь — освободился и включён в вашу."
                : "Номерки " + fmt(released) + ": у прежних участников истекла бронь — освободились и включены в вашу.",
            );
          }
          if (skipped.length) {
            parts.push("Не вошли в бронь (уже заняты): " + fmt(skipped) + ".");
          }
          showToast(parts.join(" "), released.length && !skipped.length ? "success" : skipped.length ? "warning" : "neutral");
        }
        emitUxEvent("raffle_checkout_reserved_success", {
          order_id: Number(ord.id) || 0,
          tickets: (raffleDetailState.orderNumbers || []).length,
        });
        fetchCartFromApi().catch(function () {});
        fetchTicketsFromApi().catch(function () {});
        loadRaffleTicketSlice().catch(function () {});
      })
      .catch(function (err) {
        var em = String((err && err.message) || "Ошибка");
        if (em === "SESSION_EXPIRED") {
          showActionErrorModal("Сессия истекла", "Войдите снова и повторите бронирование.", function () {
            openModal(modalLogin);
          });
        } else {
          showActionErrorModal("Не удалось создать бронь", em, function () {
            document.getElementById("modal-cart-checkout")?.click();
          });
        }
        setCartCheckoutLoading(false);
      })
      .finally(function () {
        if (!(modalReserveSuccess && modalReserveSuccess.classList.contains("is-open"))) {
          setCartCheckoutLoading(false);
        }
      });
  });

  document.getElementById("modal-tickets-close")?.addEventListener("click", function () {
    closeTicketsModal();
  });
  document.getElementById("modal-tickets-guide-dismiss")?.addEventListener("click", function () {
    dismissTicketsGuideForever();
  });
  modalTickets?.addEventListener("click", function (e) {
    if (e.target === modalTickets) closeTicketsModal();
  });
  modalTickets?.addEventListener("input", function (e) {
    var t = e.target;
    if (!t || t.getAttribute("data-tickets-lookup") !== "1") return;
    var raffleId = Number(t.getAttribute("data-raffle-id"));
    var orderId = Number(t.getAttribute("data-order-id"));
    var row = t.closest(".tickets-add-row");
    var span = row && row.querySelector("[data-tickets-lookup-status]");
    var raw = String(t.value || "").replace(/\D/g, "");
    var key = String(orderId);
    if (ticketsLookupTimers[key]) clearTimeout(ticketsLookupTimers[key]);
    if (!span) return;
    if (!raw) {
      setTicketLookupSuffix(span, null, NaN);
      return;
    }
    var n = parseInt(raw, 10);
    if (!Number.isFinite(raffleId) || !Number.isFinite(orderId)) return;
    if (!Number.isFinite(n) || n < 1) {
      setTicketLookupSuffix(span, null, NaN);
      return;
    }
    ticketsLookupTimers[key] = setTimeout(function () {
      ticketsLookupTimers[key] = null;
      fetch("/api/raffles/" + String(raffleId) + "/ticket-lookup?n=" + String(n), {
        cache: "no-store",
        headers: authHeaders(),
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d: d };
          });
        })
        .then(function (x) {
          if (!x.ok) throw new Error();
          setTicketLookupSuffix(span, x.d.kind, n);
        })
        .catch(function () {
          setTicketLookupSuffix(span, "error", n);
        });
    }, 320);
  });
  modalTickets?.addEventListener("click", function (e) {
    var attach = e.target.closest("[data-tickets-attach]");
    if (attach) {
      e.preventDefault();
      var attachOrderId = Number(attach.getAttribute("data-order-id"));
      var attachRaffleId = Number(attach.getAttribute("data-raffle-id"));
      var attachAmount = Number(attach.getAttribute("data-amount-rub"));
      var attachUntil = Number(attach.getAttribute("data-reserved-until"));
      if (!Number.isFinite(attachOrderId) || attachOrderId < 1) return;
      if (Number.isFinite(attachUntil) && attachUntil > 0 && getRaffleReservationLeftMs(attachUntil) <= 0) {
        showToast("Срок брони уже истёк", "warning");
        ticketsModalAfterMutation().catch(function () {});
        return;
      }
      reserveFlowState.orderId = attachOrderId;
      reserveFlowState.raffleId = Number.isFinite(attachRaffleId) ? attachRaffleId : 0;
      reserveFlowState.amountRub = Number.isFinite(attachAmount) ? attachAmount : 0;
      reserveFlowState.reservedUntil = Number.isFinite(attachUntil) ? attachUntil : 0;
      reserveFlowState.numbers = [];
      renderReserveFlowModals();
      switchReservePaymentStep("confirm");
      if (modalTickets) closeModal(modalTickets);
      if (modalReservePayment) openModal(modalReservePayment);
      startReservePaymentTimer(reserveFlowState.reservedUntil);
      return;
    }
    var rm = e.target.closest("[data-tickets-remove]");
    if (rm) {
      e.preventDefault();
      var orderIdR = Number(rm.getAttribute("data-order-id"));
      var ticketR = Number(rm.getAttribute("data-ticket"));
      if (!Number.isFinite(orderIdR) || !Number.isFinite(ticketR)) return;
      fetch("/api/raffles/orders/" + String(orderIdR) + "/tickets/" + String(ticketR), {
        method: "DELETE",
        headers: authHeaders(),
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d: d };
          });
        })
        .then(function (x) {
          if (!x.ok) throw new Error(x.d.error || "Ошибка");
          applyRaffleServerTimeSkewFromPayload(x.d);
          return ticketsModalAfterMutation();
        })
        .catch(function (err) {
          showToast(String(err.message || "Ошибка"), "error");
        });
      return;
    }
    var addB = e.target.closest("[data-tickets-add]");
    if (addB) {
      e.preventDefault();
      var oidA = Number(addB.getAttribute("data-order-id"));
      var rowA = addB.closest(".tickets-add-row");
      var inpA = rowA && rowA.querySelector(".tickets-lookup-input");
      var rawA = inpA ? String(inpA.value || "").replace(/\D/g, "") : "";
      var numA = parseInt(rawA, 10);
      if (!Number.isFinite(oidA) || !Number.isFinite(numA) || numA < 1) {
        showToast("Укажите номер", "warning");
        return;
      }
      apiJson("/api/raffles/orders/" + String(oidA) + "/add-tickets", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ numbers: [numA] }),
      })
        .then(function (d) {
          applyRaffleServerTimeSkewFromPayload(d);
          return ticketsModalAfterMutation();
        })
        .catch(function (err) {
          showToast(String(err.message || "Ошибка"), "error");
        });
      return;
    }
    var rnd = e.target.closest("[data-tickets-random]");
    if (rnd) {
      e.preventDefault();
      var oidR = Number(rnd.getAttribute("data-order-id"));
      var cntR = Number(rnd.getAttribute("data-count") || "1");
      if (!Number.isFinite(oidR) || !Number.isFinite(cntR) || cntR < 1) return;
      apiJson("/api/raffles/orders/" + String(oidR) + "/random-tickets", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ count: cntR }),
      })
        .then(function (d) {
          applyRaffleServerTimeSkewFromPayload(d);
          return ticketsModalAfterMutation();
        })
        .catch(function (err) {
          showToast(String(err.message || "Ошибка"), "error");
        });
    }
  });

  function updateTicketSearchApplyUI() {
    var apply = document.getElementById("ticket-search-apply");
    var rawEl = document.getElementById("ticket-search-input");
    var field = document.getElementById("ticket-search-field");
    var badge = document.getElementById("ticket-search-status-badge");
    if (!apply || !rawEl) return;

    function setField(mode) {
      if (!field) return;
      field.className = "ticket-search-sheet__field" + (mode ? " ticket-search-sheet__field--" + mode : "");
    }

    function setBadge(text, variant) {
      if (!badge) return;
      if (!text) {
        badge.className = "ticket-search-status-badge ticket-search-status-badge--empty";
        badge.textContent = "";
        return;
      }
      badge.className = "ticket-search-status-badge ticket-search-status-badge--" + variant;
      badge.textContent = text;
    }

    var v = String(rawEl.value || "").trim();
    var digits = v.replace(/\D/g, "");
    var n = parseInt(digits, 10);
    var r = raffleDetailState.raffle;

    if (!digits || !Number.isFinite(n) || n < 1) {
      apply.disabled = true;
      apply.textContent = "Укажите свободный номер";
      apply.className = "btn btn--primary ticket-search-sheet__cta";
      setField("");
      setBadge("", "");
      return;
    }

    if (r && (n < 1 || n > Number(r.ticket_count))) {
      apply.disabled = true;
      apply.textContent = "Укажите свободный номер";
      apply.className = "btn btn--primary ticket-search-sheet__cta";
      setField("invalid");
      setBadge("НЕТ ТАКОГО", "invalid");
      return;
    }

    var lk = ticketSearchLastLookup;
    if (!lk || lk.n !== n) {
      apply.disabled = true;
      apply.textContent = "Проверяем…";
      apply.className = "btn btn--primary ticket-search-sheet__cta";
      setField("loading");
      setBadge("", "");
      return;
    }

    if (lk.kind === "error") {
      apply.disabled = true;
      apply.textContent = "Укажите свободный номер";
      apply.className = "btn btn--primary ticket-search-sheet__cta";
      setField("invalid");
      setBadge("ОШИБКА", "invalid");
      return;
    }

    if (lk.kind === "free") {
      if (raffleDetailState.selected && raffleDetailState.selected.has(n)) {
        apply.disabled = true;
        apply.textContent = "Уже выбран №" + String(n);
        apply.className = "btn btn--primary ticket-search-sheet__cta";
        setField("self");
        setBadge("УЖЕ В КОРЗИНЕ", "self");
        return;
      }
      apply.disabled = false;
      apply.textContent = "Добавить №" + String(n);
      apply.className = "btn btn--primary ticket-search-sheet__cta ticket-search-sheet__cta--primary-dark";
      setField("free");
      setBadge("СВОБОДЕН", "free");
      return;
    }

    if (lk.kind === "self_reserved" || lk.kind === "self_pending" || lk.kind === "self_confirmed") {
      apply.disabled = true;
      apply.textContent = "Добавить №" + String(n);
      apply.className = "btn btn--primary ticket-search-sheet__cta";
      setField("self");
      setBadge("ВАШ", "self");
      return;
    }

    if (lk.kind === "taken") {
      apply.disabled = true;
      apply.textContent = "Укажите свободный номер";
      apply.className = "btn btn--primary ticket-search-sheet__cta";
      setField("taken");
      setBadge("ЗАНЯТО", "taken");
      return;
    }

    apply.disabled = true;
    apply.textContent = "Укажите свободный номер";
    apply.className = "btn btn--primary ticket-search-sheet__cta";
    setField("invalid");
    setBadge("НЕТ ТАКОГО", "invalid");
  }

  function scheduleTicketSearchLookup() {
    var inp = document.getElementById("ticket-search-input");
    var r = raffleDetailState.raffle;
    if (ticketSearchLookupTimer) clearTimeout(ticketSearchLookupTimer);
    if (!inp || !r || !r.id) return;
    var raw = String(inp.value || "").replace(/\D/g, "");
    var n = parseInt(raw, 10);
    if (!raw || !Number.isFinite(n) || n < 1) {
      ticketSearchLastLookup = { n: NaN, kind: null };
      updateTicketSearchApplyUI();
      return;
    }
    if (n > Number(r.ticket_count)) {
      ticketSearchLastLookup = { n: NaN, kind: null };
      updateTicketSearchApplyUI();
      return;
    }
    ticketSearchLastLookup = { n: NaN, kind: null };
    updateTicketSearchApplyUI();
    ticketSearchLookupTimer = setTimeout(function () {
      ticketSearchLookupTimer = null;
      fetch("/api/raffles/" + String(r.id) + "/ticket-lookup?n=" + String(n), {
        cache: "no-store",
        headers: authHeaders(),
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d: d };
          });
        })
        .then(function (x) {
          if (!x.ok) throw new Error();
          var inp2 = document.getElementById("ticket-search-input");
          var cur = inp2 ? String(inp2.value || "").replace(/\D/g, "") : "";
          if (parseInt(cur, 10) !== n) return;
          ticketSearchLastLookup = { n: n, kind: x.d.kind };
          updateTicketSearchApplyUI();
        })
        .catch(function () {
          var inp3 = document.getElementById("ticket-search-input");
          var cur2 = inp3 ? String(inp3.value || "").replace(/\D/g, "") : "";
          if (parseInt(cur2, 10) !== n) return;
          ticketSearchLastLookup = { n: n, kind: "error" };
          updateTicketSearchApplyUI();
        });
    }, 320);
  }

  document.getElementById("modal-ticket-search-close")?.addEventListener("click", function () {
    closeTicketSearchModal();
  });
  modalTicketSearch?.addEventListener("click", function (e) {
    if (e.target === modalTicketSearch) closeTicketSearchModal();
    var rm = e.target.closest("[data-ticket-search-picked-remove]");
    if (rm) {
      e.preventDefault();
      var n = Number(rm.getAttribute("data-ticket-search-picked-remove"));
      if (!Number.isFinite(n)) return;
      raffleDetailState.selected.delete(n);
      updateRaffleSelectionLabel();
      scheduleRaffleSelectionSync();
      syncVisibleGridCellSelectionState(n);
      return;
    }
    var goCart = e.target.closest("#ticket-search-go-cart");
    if (goCart) {
      e.preventDefault();
      closeTicketSearchModal();
      setTimeout(function () {
        openCartModal().catch(function () {});
      }, 120);
    }
  });
  document.getElementById("ticket-search-input")?.addEventListener("input", function () {
    scheduleTicketSearchLookup();
  });
  document.getElementById("ticket-search-mode-enter")?.addEventListener("click", function () {
    var mEnter = document.getElementById("ticket-search-mode-enter");
    var mRand = document.getElementById("ticket-search-mode-random");
    var pEnter = document.getElementById("ticket-search-panel-enter");
    var pRand = document.getElementById("ticket-search-panel-random");
    if (mEnter && mRand) {
      mEnter.classList.add("ticket-search-sheet__seg--active");
      mRand.classList.remove("ticket-search-sheet__seg--active");
      mEnter.setAttribute("aria-selected", "true");
      mRand.setAttribute("aria-selected", "false");
    }
    if (pEnter && pRand) {
      pEnter.hidden = false;
      pRand.hidden = true;
    }
  });
  document.getElementById("ticket-search-mode-random")?.addEventListener("click", function () {
    var mEnter = document.getElementById("ticket-search-mode-enter");
    var mRand = document.getElementById("ticket-search-mode-random");
    var pEnter = document.getElementById("ticket-search-panel-enter");
    var pRand = document.getElementById("ticket-search-panel-random");
    if (mEnter && mRand) {
      mRand.classList.add("ticket-search-sheet__seg--active");
      mEnter.classList.remove("ticket-search-sheet__seg--active");
      mRand.setAttribute("aria-selected", "true");
      mEnter.setAttribute("aria-selected", "false");
    }
    if (pEnter && pRand) {
      pRand.hidden = false;
      pEnter.hidden = true;
    }
    updateTicketSearchRandomPanel();
  });
  document.getElementById("ticket-search-random-minus")?.addEventListener("click", function () {
    if (ticketSearchRandomQty > 1) {
      ticketSearchRandomQty -= 1;
      updateTicketSearchRandomPanel();
    }
  });
  document.getElementById("ticket-search-random-plus")?.addEventListener("click", function () {
    var max = getTicketSearchSlotsLeft();
    if (ticketSearchRandomQty < max) {
      ticketSearchRandomQty += 1;
      updateTicketSearchRandomPanel();
    }
  });
  document.querySelectorAll("[data-random-preset]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var v = Number(btn.getAttribute("data-random-preset"));
      if (!Number.isFinite(v) || v < 1) return;
      var max = getTicketSearchSlotsLeft();
      ticketSearchRandomQty = Math.min(v, Math.max(1, max));
      updateTicketSearchRandomPanel();
    });
  });
  document.getElementById("ticket-search-apply")?.addEventListener("click", function () {
    if (!IS_RAFFLE_PURCHASE_PAGE) return;
    if (isRaffleLockedByReceiptPending()) {
      openWaitReceiptModal();
      return;
    }
    var r = raffleDetailState.raffle;
    if (!r || !r.id) return;
    var raw = document.getElementById("ticket-search-input");
    var n = parseInt(String(raw && raw.value ? raw.value : "").replace(/\D/g, ""), 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (ticketSearchLastLookup.kind !== "free" || ticketSearchLastLookup.n !== n) return;
    if (raffleDetailState.selected && raffleDetailState.selected.has(n)) {
      showToast("Номер уже выбран", "warning");
      updateTicketSearchApplyUI();
      return;
    }
    ensureRaffleTabForNumber(n)
      .then(function () {
        if (raffleDetailState.selected.size >= RAFFLE_MAX_SELECT) {
          showToast("Можно выбрать не более " + String(RAFFLE_MAX_SELECT) + " номерков", "warning");
          return false;
        }
        raffleDetailState.selected.add(n);
        updateRaffleSelectionLabel();
        scheduleRaffleSelectionSync();
        syncVisibleGridCellSelectionState(n);
        return true;
      })
      .then(function (ok) {
        if (!ok) return;
        showToast("Номер " + String(n) + " добавлен в корзину", "success");
      })
      .catch(function (e) {
        showToast(String(e.message || "Ошибка"), "error");
      });
  });
  document.getElementById("ticket-search-random-apply")?.addEventListener("click", function () {
    if (!IS_RAFFLE_PURCHASE_PAGE) return;
    if (isRaffleLockedByReceiptPending()) {
      openWaitReceiptModal();
      return;
    }
    var r = raffleDetailState.raffle;
    if (!r || !r.id) return;
    clampTicketSearchRandomQty();
    var want = ticketSearchRandomQty;
    var maxSlots = getTicketSearchSlotsLeft();
    if (maxSlots < 1) {
      showToast("Достигнут лимит выбора номерков", "warning");
      return;
    }
    want = Math.min(want, maxSlots);
    var from = raffleDetailState.rangeFrom;
    var to = raffleDetailState.rangeTo;
    fetch("/api/raffles/" + String(r.id) + "/tickets?from=" + String(from) + "&to=" + String(to), {
      cache: "no-store",
      headers: authHeaders(),
    })
      .then(function (res) {
        return res.json().then(function (d) {
          return { ok: res.ok, d: d };
        });
      })
      .then(function (x) {
        if (!x.ok) throw new Error(x.d.error || "Ошибка");
        var cells = x.d.cells || [];
        var freeNums = [];
        var i;
        for (i = 0; i < cells.length; i++) {
          if (cells[i].kind === "free") freeNums.push(cells[i].n);
        }
        var candidates = freeNums.filter(function (num) {
          return !raffleDetailState.selected.has(num);
        });
        if (!candidates.length) {
          showToast("Нет свободных номеров в этом диапазоне", "warning");
          return false;
        }
        var picks = [];
        var pool = candidates.slice();
        for (i = 0; i < want && pool.length; i++) {
          var idx = Math.floor(Math.random() * pool.length);
          picks.push(pool[idx]);
          pool.splice(idx, 1);
        }
        if (!picks.length) return false;
        picks.forEach(function (num) {
          raffleDetailState.selected.add(num);
        });
        updateRaffleSelectionLabel();
        scheduleRaffleSelectionSync();
        picks.forEach(function (num) {
          syncVisibleGridCellSelectionState(num);
        });
        return picks.length;
      })
      .then(function (added) {
        if (!added) return;
        showToast(
          added === 1 ? "Случайный номер добавлен" : "Добавлено случайных номеров: " + String(added),
          "success",
        );
      })
      .catch(function (e) {
        showToast(String(e.message || "Ошибка"), "error");
      });
  });

  const btnRegisterMain = document.getElementById("btn-register-main");
  const btnLoginLink = document.getElementById("btn-login-link");

  const formRegister = document.getElementById("form-register");
  const formLogin = document.getElementById("form-login");
  const formForgot = document.getElementById("form-forgot");

  const phoneReg = document.getElementById("phone-reg");
  const phoneLogin = document.getElementById("phone-login");

  bindPhoneInput(phoneReg);
  bindPhoneInput(phoneLogin);

  bindPasswordToggle(document.getElementById("toggle-pass-reg"), "pass-reg");
  bindPasswordToggle(document.getElementById("toggle-pass-reg2"), "pass-reg2");
  bindPasswordToggle(document.getElementById("toggle-pass-login"), "pass-login");

  function clearBottomSheetDrag(overlay) {
    if (!overlay || !overlay.id) return;
    if (overlay.id === "modal-cart") {
      var cs = document.getElementById("modal-cart-sheet");
      if (cs) cs.style.removeProperty("--sheet-drag-y");
      return;
    }
    if (overlay.id === "modal-tickets") {
      var ts = modalTickets && modalTickets.querySelector(".modal--tickets-sheet");
      if (ts) ts.style.removeProperty("--sheet-drag-y");
      return;
    }
    if (overlay.id === "modal-ticket-search") {
      var ss = modalTicketSearch && modalTicketSearch.querySelector(".ticket-search-sheet");
      if (ss) ss.style.removeProperty("--sheet-drag-y");
      return;
    }
    if (overlay.id === "modal-profile") {
      var ps = modalProfile && modalProfile.querySelector(".profile-modal");
      if (ps) ps.style.removeProperty("--sheet-drag-y");
    }
  }

  function openModal(overlay) {
    if (!overlay) return;
    clearBottomSheetDrag(overlay);
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setTimeout(function () {
      var focusables = overlay.querySelectorAll(
        "button:not([disabled]):not([hidden]), a[href]:not([hidden]), input:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), select:not([disabled]):not([hidden])",
      );
      var firstAction = null;
      for (var fi = 0; fi < focusables.length; fi++) {
        var el = focusables[fi];
        if (el.closest("[hidden]")) continue;
        var rects = typeof el.getClientRects === "function" ? el.getClientRects() : null;
        if (!rects || rects.length === 0) continue;
        firstAction = el;
        break;
      }
      if (firstAction && typeof firstAction.focus === "function") firstAction.focus();
    }, 20);
  }

  function closeModal(overlay) {
    if (!overlay) return;
    if (overlay.id === "modal-wait-receipt") stopWaitReceiptModalTimer();
    clearBottomSheetDrag(overlay);
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (overlay.id === "modal-cart") {
      document.getElementById("tab-cart")?.classList.remove("bottom-nav-btn--cart-open");
      setBottomNavActive();
      return;
    }
    if (overlay.id === "modal-tickets") {
      setBottomNavActive();
      return;
    }
    if (overlay.id === "modal-ticket-search") {
      setBottomNavActive();
      return;
    }
    if (overlay.id === "modal-profile") setBottomNavActive();
  }

  function closeAllModals() {
    closeCartModal();
    closeTicketsModal();
    closeTicketSearchModal();
    if (modalReserveSuccess) closeModal(modalReserveSuccess);
    closeReservePaymentModal();
    if (modalWaitReceipt) closeModal(modalWaitReceipt);
    if (modalReserveExpired) closeModal(modalReserveExpired);
    [modalRegister, modalLogin, modalForgot, modalProfile, modalInstallApp].forEach(closeModal);
    closeRaffleUnavailableModal();
    if (modalActionError) closeModal(modalActionError);
  }

  function showActionErrorModal(title, message, onRetry) {
    if (!modalActionError) {
      showToast(message || title || "Ошибка", "error");
      return;
    }
    var ttl = document.getElementById("action-error-title");
    var txt = document.getElementById("action-error-text");
    if (ttl) ttl.textContent = title || "Не удалось выполнить действие";
    if (txt) txt.textContent = message || "Проверьте соединение и попробуйте снова.";
    lastActionErrorRetry = typeof onRetry === "function" ? onRetry : null;
    openModal(modalActionError);
  }

  function openProfileModal() {
    closeCartModal();
    closeTicketsModal();
    closeTicketSearchModal();
    renderDashboard();
    openModal(modalProfile);
    setBottomNavActive();
  }

  function closeProfileModal() {
    closeModal(modalProfile);
  }

  /** Свайп вниз по нижним шторкам (мобильная ширина): закрытие как в нативных приложениях */
  (function initBottomSheetSwipeDismiss() {
    var mq = window.matchMedia("(max-width: 640px)");
    var THRESHOLD = 100;
    var cartSheet = document.getElementById("modal-cart-sheet");
    var ticketsSheet = modalTickets && modalTickets.querySelector(".modal--tickets-sheet");
    var searchSheet = modalTicketSearch && modalTicketSearch.querySelector(".ticket-search-sheet");
    var profileSheet = modalProfile && modalProfile.querySelector(".profile-modal");

    /**
     * Закрытие свайпом только с «ручки» и шапки — иначе скролл контента уводил шторку.
     * @param {string} dragHandleSelector селектор зоны захвата (closest от target)
     */
    function bind(overlay, panel, closeFn, dragHandleSelector) {
      if (!overlay || !panel || !dragHandleSelector) return;
      var startY = 0;
      var startX = 0;
      var lastDy = 0;
      var active = false;
      var moveHandler = null;

      function detachMove() {
        if (moveHandler) {
          panel.removeEventListener("touchmove", moveHandler);
          moveHandler = null;
        }
      }

      function onTouchStart(e) {
        detachMove();
        if (!mq.matches) return;
        if (!overlay.classList.contains("is-open")) return;
        if (e.touches.length !== 1) return;
        var target = e.target;
        if (!(target instanceof Element)) return;
        if (!target.closest(dragHandleSelector)) return;
        if (target.closest("button, a, input, textarea, select, [role='tab']")) return;
        active = true;
        lastDy = 0;
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        moveHandler = function (ev) {
          if (!active || !overlay.classList.contains("is-open")) return;
          var y = ev.touches[0].clientY;
          var x = ev.touches[0].clientX;
          var dy = y - startY;
          var dx = x - startX;
          if (dy < 0) dy = 0;
          if (Math.abs(dy) < 8 && Math.abs(dy) < Math.abs(dx)) return;
          ev.preventDefault();
          lastDy = dy;
          panel.style.setProperty("--sheet-drag-y", dy + "px");
        };
        panel.addEventListener("touchmove", moveHandler, { passive: false });
      }

      function onTouchEnd() {
        detachMove();
        if (!active) return;
        active = false;
        var dy = lastDy;
        panel.style.removeProperty("--sheet-drag-y");
        if (dy > THRESHOLD) {
          closeFn();
        }
        lastDy = 0;
      }

      panel.addEventListener("touchstart", onTouchStart, { passive: true });
      panel.addEventListener("touchend", onTouchEnd);
      panel.addEventListener("touchcancel", onTouchEnd);
    }

    bind(modalCart, cartSheet, closeCartModal, ".cart-sheet__grabber, .cart-sheet__head");
    bind(modalTickets, ticketsSheet, closeTicketsModal, ".cart-sheet__grabber, .tickets-sheet__header");
    bind(modalTicketSearch, searchSheet, closeTicketSearchModal, ".ticket-search-sheet__grabber, .ticket-search-sheet__head");
    bind(modalProfile, profileSheet, closeProfileModal, ".profile-modal__sheet-handle");
  })();

  var TOAST_SVG = {
    success:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    neutral:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  };

  function ensureToastEl() {
    var t = document.getElementById("toast");
    if (t) return t;
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");
    t.setAttribute("aria-atomic", "true");
    t.innerHTML =
      '<span class="toast__icon" aria-hidden="true"></span><span class="toast__text"></span>';
    t.addEventListener("click", function (e) {
      e.preventDefault();
      dismissToast();
    });
    document.body.appendChild(t);
    return t;
  }

  function dismissToast() {
    var t = document.getElementById("toast");
    if (!t || !t.classList.contains("is-visible")) return;
    clearTimeout(showToast._tid);
    showToast._tid = null;
    t.classList.add("is-exiting");
    var finished = false;
    function done() {
      if (finished) return;
      finished = true;
      t.classList.remove("is-visible", "is-exiting");
      t.removeEventListener("transitionend", onEnd);
    }
    function onEnd(e) {
      if (e.target !== t) return;
      if (e.propertyName !== "transform" && e.propertyName !== "opacity") return;
      done();
    }
    t.addEventListener("transitionend", onEnd);
    window.setTimeout(done, 420);
  }

  /**
   * @param {string} message
   * @param {{ type?: string, duration?: number } | string} [options] тип или { type, duration }
   */
  function showToast(message, options) {
    var opts = typeof options === "string" ? { type: options } : options || {};
    var type = opts.type || "info";
    var duration = typeof opts.duration === "number" ? opts.duration : 3600;
    var allowed = { success: 1, error: 1, warning: 1, info: 1, neutral: 1 };
    if (!allowed[type]) type = "info";

    var t = ensureToastEl();
    clearTimeout(showToast._tid);
    showToast._tid = null;
    t.classList.remove("is-visible", "is-exiting");
    t.className = "toast toast--" + type;
    t.setAttribute("aria-label", message + ". Нажмите, чтобы закрыть.");
    var iconEl = t.querySelector(".toast__icon");
    var textEl = t.querySelector(".toast__text");
    if (iconEl) iconEl.innerHTML = TOAST_SVG[type] || TOAST_SVG.info;
    if (textEl) textEl.textContent = message;

    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        t.classList.add("is-visible");
      });
    });

    showToast._tid = window.setTimeout(function () {
      dismissToast();
    }, duration);
  }

  function refreshAccountBlockedUI() {
    var el = document.getElementById("account-blocked-screen");
    var root = document.documentElement;
    var blocked = !!accountBlocked;
    if (el) {
      el.hidden = !blocked;
      el.setAttribute("aria-hidden", blocked ? "false" : "true");
    }
    root.classList.toggle("js-account-blocked", blocked);
    var btnLogout = document.getElementById("btn-profile-logout");
    if (btnLogout) btnLogout.hidden = blocked;
    if (blocked) {
      closeChatPanel();
      closeAllModals();
    }
  }

  function updateScreens() {
    session = loadSession();
    try {
      if (session && session.blocked) accountBlocked = true;
    } catch (_) {}
    const authed = !!(session && session.token && session.phone && authVerified);
    /** На /home и страницах акции лента только после успешной проверки сессии */
    const showAuthedUi =
      IS_HOME_APP || IS_RAFFLE_PURCHASE_PAGE || IS_RAFFLE_PAY_PAGE || IS_HOME_SETTINGS_PAGE
        ? !!(session && session.token && session.phone && (authVerified || authCheckInFlight))
        : IS_GUEST_LANDING
          ? false
          : authed;
    if (IS_HOME_APP || IS_RAFFLE_PURCHASE_PAGE || IS_RAFFLE_PAY_PAGE || IS_HOME_SETTINGS_PAGE) {
      const hasSession = !!(session && session.token && session.phone);
      if (!hasSession) {
        location.replace("/");
        return;
      }
    }
    if (welcomeScreen) welcomeScreen.classList.toggle("screen--hidden", showAuthedUi);
    if (appScreen) appScreen.classList.toggle("screen--hidden", !showAuthedUi);
    renderDashboard();
    var shell = document.getElementById("app-shell");
    var nav = document.getElementById("bottom-nav");
    if (shell) {
      if (IS_GUEST_LANDING) {
        shell.classList.add("app-shell--guest");
        shell.classList.remove("app-shell--with-tabbar");
      } else {
        shell.classList.toggle("app-shell--guest", !showAuthedUi);
        shell.classList.toggle("app-shell--with-tabbar", showAuthedUi);
      }
    }
    if (nav) {
      nav.classList.toggle("bottom-nav--hidden", !showAuthedUi);
    }
    syncHtmlAuthClasses();
    if (authed) {
      setAppView(appView);
    } else {
      closeChatPanel();
      if (modalProfile) closeModal(modalProfile);
    }
    if (showAuthedUi && IS_HOME_APP && !accountBlocked) {
      syncCartChrome().catch(function () {});
    }
    refreshAccountBlockedUI();
    if (authed && !IS_GUEST_LANDING) {
      if (chatUnreadPollTimer == null) startChatUnreadPolling();
      else refreshChatUnreadCount();
      if (!liveWs) connectLiveWs();
    } else {
      stopChatUnreadPolling();
      setChatTabUnreadHighlight(false);
      disconnectLiveWs();
    }
  }

  async function verifySessionOnLoad() {
    const s = loadSession();
    if (!s || !s.token) return;
    authCheckInFlight = true;
    updateScreens();
    try {
      const data = await apiJson("/api/auth/me", {
        headers: { Authorization: "Bearer " + s.token },
      });
      authVerified = true;
      accountBlocked = !!data.user.blocked;
      saveSession({
        ...s,
        phone: data.user.phone,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role || "user",
        blocked: accountBlocked,
      });
    } catch (err) {
      if (err && err.status === 401) {
        invalidateSession("Сессия истекла. Войдите снова.");
        return;
      }
      authVerified = false;
      accountBlocked = false;
      showToast("Не удалось проверить сессию. Попробуйте войти снова.", "warning");
    } finally {
      authCheckInFlight = false;
      updateScreens();
    }
  }

  function sessionPayload(data) {
    return {
      token: data.token,
      phone: data.user.phone,
      name: data.user.name,
      email: data.user.email,
      role: data.user.role || "user",
      blocked: !!data.user.blocked,
    };
  }

  function initWelcomeSplash() {
    const splash = document.getElementById("welcome-splash");
    if (!splash) return;
    try {
      const s = loadSession();
      const hasSession = !!(s && s.token && s.phone);
      if (!hasSession) {
        splash.classList.remove("welcome-splash--dismissed");
        splash.setAttribute("aria-hidden", "false");
        document.documentElement.classList.remove("js-intro-done");
      }
    } catch (_) {}
  }

  function syncHtmlAuthClasses() {
    const root = document.documentElement;
    const s = loadSession();
    const hasToken = !!(s && s.token && s.phone);
    root.classList.remove("js-has-session", "js-guest");
    if (hasToken && !IS_GUEST_LANDING) {
      root.classList.add("js-has-session");
    } else {
      root.classList.add("js-guest");
    }
    root.classList.toggle("js-auth-verified", authVerified);
  }

  if (btnRegisterMain) {
    btnRegisterMain.addEventListener("click", function () {
      openModal(modalRegister);
    });
  }

  if (btnLoginLink) {
    btnLoginLink.addEventListener("click", function () {
      openModal(modalLogin);
    });
  }

  const btnSplashReg = document.getElementById("btn-splash-register");
  const btnSplashLogin = document.getElementById("btn-splash-login");
  if (btnSplashReg) {
    btnSplashReg.addEventListener("click", function () {
      openModal(modalRegister);
    });
  }
  if (btnSplashLogin) {
    btnSplashLogin.addEventListener("click", function () {
      openModal(modalLogin);
    });
  }

  document.getElementById("btn-splash-install-app")?.addEventListener("click", function () {
    openInstallAppModal();
  });
  document.getElementById("btn-home-install-app")?.addEventListener("click", function () {
    openInstallAppModal();
  });

  document.getElementById("modal-install-app-close")?.addEventListener("click", function () {
    closeModal(modalInstallApp);
  });
  if (modalInstallApp) {
    modalInstallApp.addEventListener("click", function (e) {
      if (e.target === modalInstallApp) closeModal(modalInstallApp);
    });
  }
  document.getElementById("install-app-tab-ios")?.addEventListener("click", function () {
    setInstallAppTab("ios");
  });
  document.getElementById("install-app-tab-android")?.addEventListener("click", function () {
    setInstallAppTab("android");
  });
  document.getElementById("btn-install-app-chrome")?.addEventListener("click", function () {
    if (!deferredInstallPrompt) return;
    var p = deferredInstallPrompt;
    deferredInstallPrompt = null;
    p.prompt();
    if (p.userChoice && typeof p.userChoice.then === "function") {
      p.userChoice.then(function () {}).catch(function () {});
    }
    var w = document.getElementById("install-app-prompt-wrap");
    if (w) w.hidden = true;
  });

  var modalRegClose = document.getElementById("modal-reg-close");
  if (modalRegClose) modalRegClose.addEventListener("click", function () {
    closeModal(modalRegister);
  });
  var modalRegBack = document.getElementById("modal-reg-back");
  if (modalRegBack) modalRegBack.addEventListener("click", function () {
    closeModal(modalRegister);
  });

  var modalLoginClose = document.getElementById("modal-login-close");
  if (modalLoginClose) modalLoginClose.addEventListener("click", function () {
    closeModal(modalLogin);
  });
  var modalLoginBack = document.getElementById("modal-login-back");
  if (modalLoginBack) modalLoginBack.addEventListener("click", function () {
    closeModal(modalLogin);
  });

  document.getElementById("link-to-register")?.addEventListener("click", function (e) {
    e.preventDefault();
    closeModal(modalLogin);
    openModal(modalRegister);
  });

  document.getElementById("link-forgot")?.addEventListener("click", function (e) {
    e.preventDefault();
    closeModal(modalLogin);
    openModal(modalForgot);
  });

  var modalForgotClose = document.getElementById("modal-forgot-close");
  if (modalForgotClose) modalForgotClose.addEventListener("click", function () {
    closeModal(modalForgot);
  });
  var modalForgotBack = document.getElementById("modal-forgot-back");
  if (modalForgotBack) modalForgotBack.addEventListener("click", function () {
    closeModal(modalForgot);
    openModal(modalLogin);
  });

  document.getElementById("link-login-from-reg")?.addEventListener("click", function (e) {
    e.preventDefault();
    closeModal(modalRegister);
    openModal(modalLogin);
  });

  [modalRegister, modalLogin, modalForgot, modalProfile].forEach(function (ov) {
    if (!ov) return;
    ov.addEventListener("click", function (e) {
      if (e.target === ov) closeModal(ov);
    });
  });

  var profileModalClose = document.getElementById("profile-modal-close");
  if (profileModalClose) profileModalClose.addEventListener("click", function () {
    closeProfileModal();
  });
  var profileModalDismiss = document.getElementById("profile-modal-dismiss");
  if (profileModalDismiss) profileModalDismiss.addEventListener("click", function () {
    closeProfileModal();
  });

  if (formRegister) formRegister.addEventListener("submit", function (e) {
    e.preventDefault();
    const phone = phoneToNormalized(phoneReg.value);
    if (phone.length !== 11) {
      showToast("Введите полный номер телефона", "warning");
      return;
    }
    if (!isValidRuMobilePhone(phone)) {
      showToast("Нужен мобильный номер России (+7 9XX …)", "warning");
      return;
    }
    const name = document.getElementById("fio-reg").value.trim();
    const email = document.getElementById("email-reg").value.trim();
    const p1 = document.getElementById("pass-reg").value;
    const p2 = document.getElementById("pass-reg2").value;
    if (!name) {
      showToast("Укажите ФИО", "warning");
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast("Укажите корректный email", "warning");
      return;
    }
    if (p1.length < 6) {
      showToast("Пароль не короче 6 символов", "warning");
      return;
    }
    if (p1 !== p2) {
      showToast("Пароли не совпадают", "warning");
      return;
    }

    apiJson("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ phone, name, email, password: p1 }),
    })
      .then(function (data) {
        authVerified = true;
        saveSession(sessionPayload(data));
        session = loadSession();
        appView = "feed";
        closeAllModals();
        showToast("Добро пожаловать, " + data.user.name.split(" ")[0] + "!", "success");
        updateScreens();
        if (IS_GUEST_LANDING) {
          markNeedHomeReloadOnce();
          location.replace("/home");
          return;
        }
        formRegister.reset();
        phoneReg.value = "";
      })
      .catch(function (err) {
        showToast(err.message || "Ошибка регистрации", "error");
      });
  });

  if (formLogin) formLogin.addEventListener("submit", function (e) {
    e.preventDefault();
    const phone = phoneToNormalized(phoneLogin.value);
    if (phone.length !== 11) {
      showToast("Введите полный номер телефона", "warning");
      return;
    }
    if (!isValidRuMobilePhone(phone)) {
      showToast("Нужен мобильный номер России (+7 9XX …)", "warning");
      return;
    }
    const pass = document.getElementById("pass-login").value;
    if (!pass) {
      showToast("Введите пароль", "warning");
      return;
    }

    apiJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, password: pass }),
    })
      .then(function (data) {
        authVerified = true;
        saveSession(sessionPayload(data));
        session = loadSession();
        appView = "feed";
        closeAllModals();
        showToast("С возвращением!", "success");
        updateScreens();
        if (IS_GUEST_LANDING) {
          markNeedHomeReloadOnce();
          location.replace("/home");
          return;
        }
        formLogin.reset();
        phoneLogin.value = "";
      })
      .catch(function (err) {
        showToast(err.message || "Ошибка входа", "error");
      });
  });

  if (formForgot) formForgot.addEventListener("submit", function (e) {
    e.preventDefault();
    const email = document.getElementById("email-forgot").value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast("Введите email", "warning");
      return;
    }

    apiJson("/api/auth/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    })
      .then(function () {
        closeModal(modalForgot);
        openModal(modalLogin);
        showToast("Если email найден, мы отправим ссылку", "info");
        formForgot.reset();
      })
      .catch(function (err) {
        showToast(err.message || "Ошибка", "error");
      });
  });

  var tabChatEl = document.getElementById("tab-chat");
  if (tabChatEl) {
    tabChatEl.addEventListener("click", function () {
      const s = loadSession();
      if (!s || !s.token) {
        openModal(modalLogin);
        return;
      }
      if (!authVerified) return;
      openChatPanel();
    });
  }

  var btnChatClose = document.getElementById("btn-chat-close");
  if (btnChatClose) btnChatClose.addEventListener("click", function () {
    closeChatPanel();
  });

  const chatInput = document.getElementById("chat-input");
  const btnSend = document.getElementById("btn-chat-send");
  var formChatEl = document.getElementById("form-chat");
  var chatFileInput = document.getElementById("chat-file-input");
  var btnChatAttach = document.getElementById("btn-chat-attach");
  var chatSendInFlight = false;

  function syncChatSendState() {
    if (!chatInput || !btnSend) return;
    if (chatSendInFlight) {
      btnSend.disabled = true;
      return;
    }
    btnSend.disabled = !String(chatInput.value).trim();
  }

  function setChatComposerSending(sending) {
    chatSendInFlight = !!sending;
    var on = !!sending;
    if (btnChatAttach) btnChatAttach.disabled = on;
    if (chatInput) chatInput.disabled = on;
    if (btnSend) {
      if (on) btnSend.disabled = true;
      else syncChatSendState();
    }
  }

  function postChatMessage(text, attachment) {
    var body = { body: text };
    if (attachment) body.attachment = attachment;
    return apiJson("/api/chat/messages", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  if (chatInput) {
    chatInput.addEventListener("input", function () {
      syncChatSendState();
      clearTimeout(userTypingDebounceTimer);
      clearTimeout(userTypingIdleTimer);
      var v = String(chatInput.value).trim();
      if (!v) {
        sendUserTyping(false);
        return;
      }
      userTypingDebounceTimer = window.setTimeout(function () {
        sendUserTyping(true);
      }, 350);
      userTypingIdleTimer = window.setTimeout(function () {
        sendUserTyping(false);
      }, 2800);
    });
    chatInput.addEventListener("blur", function () {
      clearTimeout(userTypingDebounceTimer);
      clearTimeout(userTypingIdleTimer);
      userTypingDebounceTimer = null;
      userTypingIdleTimer = null;
      sendUserTyping(false);
    });
  }

  if (btnChatAttach && chatFileInput) {
    btnChatAttach.addEventListener("click", function () {
      chatFileInput.click();
    });
    chatFileInput.addEventListener("change", function () {
      var f = chatFileInput.files && chatFileInput.files[0];
      if (!f) return;
      const s = loadSession();
      if (!s || !s.token || !authVerified) return;
      if (chatSendInFlight) return;
      setChatComposerSending(true);
      var fd = new FormData();
      fd.append("file", f);
      fetch("/api/chat/upload", {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
            return data;
          });
        })
        .then(function (data) {
          var input = document.getElementById("chat-input");
          var caption = input ? String(input.value).trim() : "";
          clearTimeout(userTypingDebounceTimer);
          clearTimeout(userTypingIdleTimer);
          sendUserTyping(false);
          return postChatMessage(caption, {
            url: data.url,
            name: data.name,
            mime: data.mime,
          }).then(function (resp) {
            renderChatMessages(resp.messages || []);
            if (input) input.value = "";
            syncChatSendState();
          });
        })
        .catch(function (err) {
          showToast(err.message || "Не удалось отправить", "error");
        })
        .finally(function () {
          chatFileInput.value = "";
          setChatComposerSending(false);
          syncChatSendState();
        });
    });
  }
  if (formChatEl) formChatEl.addEventListener("submit", function (e) {
    e.preventDefault();
    const s = loadSession();
    if (!s || !s.token || !authVerified) return;
    const input = document.getElementById("chat-input");
    const text = input ? String(input.value).trim() : "";
    if (!text) return;
    if (chatSendInFlight) return;
    clearTimeout(userTypingDebounceTimer);
    clearTimeout(userTypingIdleTimer);
    sendUserTyping(false);
    var textToSend = text;
    if (input) input.value = "";
    syncChatSendState();
    setChatComposerSending(true);
    postChatMessage(textToSend, null)
      .then(function (data) {
        renderChatMessages(data.messages || []);
      })
      .catch(function (err) {
        if (input) input.value = textToSend;
        showToast(err.message || "Не удалось отправить", "error");
      })
      .finally(function () {
        setChatComposerSending(false);
        syncChatSendState();
      });
  });

  var tabScrollTopEl = document.getElementById("tab-scroll-top");
  function syncRaffleScrollTopButton() {
    if (!tabScrollTopEl) return;
    if (!IS_RAFFLE_PURCHASE_PAGE) {
      tabScrollTopEl.hidden = true;
      tabScrollTopEl.classList.remove("is-visible");
      return;
    }
    var y = Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0);
    var show = y > 320;
    tabScrollTopEl.hidden = !show;
    tabScrollTopEl.classList.toggle("is-visible", show);
  }
  if (tabScrollTopEl) {
    tabScrollTopEl.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    window.addEventListener("scroll", syncRaffleScrollTopButton, { passive: true });
    window.addEventListener("resize", syncRaffleScrollTopButton, { passive: true });
    syncRaffleScrollTopButton();
  }

  var tabSearchEl = document.getElementById("tab-search");
  if (tabSearchEl) {
    tabSearchEl.addEventListener("click", function () {
      var s = loadSession();
      if (!s || !s.token) {
        openModal(modalLogin);
        return;
      }
      if (!authVerified) return;
      if (modalTicketSearch && modalTicketSearch.classList.contains("is-open")) {
        closeTicketSearchModal();
        return;
      }
      openTicketSearchModal();
    });
  }

  var tabCartEl = document.getElementById("tab-cart");
  if (tabCartEl) {
    tabCartEl.addEventListener("click", function () {
      const s = loadSession();
      if (!s || !s.token) {
        openModal(modalLogin);
        return;
      }
      if (!authVerified) return;
      appView = "feed";
      setAppView("feed");
      openCartModal().catch(function () {});
    });
  }

  var tabTicketsEl = document.getElementById("tab-tickets");
  if (tabTicketsEl)
    tabTicketsEl.addEventListener("click", function () {
      const s = loadSession();
      if (!s || !s.token) {
        openModal(modalLogin);
        return;
      }
      if (!authVerified) return;
      appView = "feed";
      setAppView("feed");
      openTicketsModal().catch(function () {});
    });

  var tabProfileEl = document.getElementById("tab-profile");
  if (tabProfileEl) tabProfileEl.addEventListener("click", function () {
    const s = loadSession();
    if (!s || !s.token) {
      openModal(modalLogin);
      return;
    }
    if (!authVerified) return;
    closeChatPanel();
    openProfileModal();
  });

  var btnProfileLogout = document.getElementById("btn-profile-logout");
  if (btnProfileLogout) btnProfileLogout.addEventListener("click", function () {
    const s = loadSession();
    const finish = function () {
      clearSession();
      authVerified = false;
      appView = "feed";
      closeChatPanel();
      updateScreens();
      showToast("Вы вышли из аккаунта", "neutral");
    };
    if (s && s.token) {
      apiJson("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: "Bearer " + s.token },
      })
        .catch(function () {})
        .finally(finish);
    } else {
      finish();
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    var panel = document.getElementById("panel-chat");
    if (panel && !panel.classList.contains("screen--hidden")) loadChatMessagesHttp();
    if (authVerified) refreshChatUnreadCount();
    if (
      authVerified &&
      (IS_RAFFLE_PURCHASE_PAGE || IS_RAFFLE_PAY_PAGE) &&
      raffleDetailState.raffle &&
      Number.isFinite(Number(raffleDetailState.raffle.id))
    ) {
      pingRaffleView(Number(raffleDetailState.raffle.id));
    }
  });


  reconcileCookiePair();
  initWelcomeSplash();
  syncTicketsGuideVisibility();
  if (IS_HOME_APP && consumeNeedHomeReloadOnce()) {
    location.replace("/home");
    location.reload();
    return;
  }
  updateScreens();
  verifySessionOnLoad().then(function () {
    if (
      authVerified &&
      !accountBlocked &&
      (IS_HOME_APP || IS_RAFFLE_PURCHASE_PAGE || IS_RAFFLE_PAY_PAGE)
    ) {
      prefetchRaffleCaches()
        .catch(function () {})
        .finally(function () {
          syncProfileTicketCount();
        });
    }
    if (IS_HOME_APP && authVerified && !accountBlocked) {
      try {
        var ptoast = sessionStorage.getItem("ab_pending_toast");
        if (ptoast) {
          sessionStorage.removeItem("ab_pending_toast");
          var pt = JSON.parse(ptoast);
          showToast(pt.message, pt.type || "neutral");
        }
      } catch (_) {}
      try {
        if (new URLSearchParams(location.search).get("openCart") === "1") {
          history.replaceState({}, "", "/home");
          openCartModal().catch(function () {});
        }
      } catch (_) {}
    }
    if (IS_RAFFLE_PURCHASE_PAGE && authVerified) {
      return initRafflePurchasePage().catch(function (e) {
        console.error("Raffle page init failed:", e);
      });
    }
    if (IS_RAFFLE_PAY_PAGE && authVerified) {
      return initRafflePayPage().catch(function (e) {
        console.error("Raffle pay page init failed:", e);
      });
    }
    if (IS_RAFFLE_CONFIRM_PAGE && authVerified) {
      return initRaffleConfirmPage();
    }
  });
  syncChatSendState();
  if (!IS_RAFFLE_PURCHASE_PAGE && !IS_RAFFLE_PAY_PAGE && !IS_RAFFLE_CONFIRM_PAGE && !IS_HOME_SETTINGS_PAGE) {
    loadRafflesFeed();
  }
  if (IS_HOME_APP) {
    startHomeRafflesAutoRefresh();
  }
})();
