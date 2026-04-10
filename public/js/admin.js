(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";

  /** @type {Array<{id:number;phone:string;name:string;email:string;role:string;last_body:string|null;last_at:number|null;last_is_staff:number|null;unread_count:number}>} */
  let allUsersCache = [];
  /** @type {'all' | 'new' | 'unanswered'} */
  let adminTab = "all";
  /** @type {WebSocket | null} */
  let adminWs = null;

  let userTypingInThreadActive = false;
  /** @type {number | null} */
  let userTypingDotsTimer = null;
  /** @type {number | null} */
  let adminTypingDebounceTimer = null;
  /** @type {number | null} */
  let adminTypingIdleTimer = null;
  /** @type {number | null} */
  let userTypingPollTimer = null;

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

  function messageBubbleInnerHtml(m) {
    var att = attachmentHtml(m);
    var body = String(m.body || "").trim();
    var text = body ? '<div class="admin-msg-bubble__body">' + esc(m.body) + "</div>" : "";
    return att + text;
  }

  const gate = document.getElementById("admin-gate");
  const adminLoading = document.getElementById("admin-loading");
  const adminRoot = document.getElementById("admin-root");
  const app = document.getElementById("admin-app");
  const rafflesApp = document.getElementById("admin-raffles-app");
  const paymentsApp = document.getElementById("admin-payments-app");
  const usersApp = document.getElementById("admin-users-app");
  const settingsApp = document.getElementById("admin-settings-app");
  const listEl = document.getElementById("admin-user-list");
  const empty = document.getElementById("admin-empty");
  const thread = document.getElementById("admin-thread");
  const threadName = document.getElementById("admin-thread-name");
  const threadMeta = document.getElementById("admin-thread-meta");
  const messagesEl = document.getElementById("admin-messages");
  const form = document.getElementById("admin-reply-form");
  const input = document.getElementById("admin-reply-input");

  let selectedId = null;
  /** @type {{ id: number; phone: string; name: string; email: string; role: string } | null} */
  let selectedUserData = null;
  /** Пока грузится тред, не сбрасывать selectedId в loadUsers (иначе гонка с WS). */
  let threadLoadUserId = null;

  const modalEditUser = document.getElementById("modal-edit-user");

  function showGate(msg) {
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
    if (usersApp) usersApp.hidden = true;
    if (settingsApp) settingsApp.hidden = true;
  }

  function getAdminTab() {
    try {
      var u = new URL(location.href);
      var t = u.searchParams.get("tab");
      if (t === "raffles") return "raffles";
      if (t === "payments") return "payments";
      if (t === "users") return "users";
      if (t === "settings") return "settings";
      return "support";
    } catch (_) {
      return "support";
    }
  }

  function applyAdminTab() {
    var tab = getAdminTab();
    var heading = document.getElementById("admin-page-heading");
    var sub = document.getElementById("admin-page-sub");
    var navSupport = document.getElementById("nav-link-support");
    var navUsers = document.getElementById("nav-link-users");
    var navRaffles = document.getElementById("nav-link-raffles");
    var navPayments = document.getElementById("nav-link-payments");
    var navSettings = document.getElementById("nav-link-settings");

    if (app) app.hidden = tab !== "support";
    if (rafflesApp) rafflesApp.hidden = tab !== "raffles";
    if (paymentsApp) paymentsApp.hidden = tab !== "payments";
    if (usersApp) usersApp.hidden = tab !== "users";
    if (settingsApp) settingsApp.hidden = tab !== "settings";

    if (heading) {
      heading.textContent =
        tab === "raffles"
          ? "Акции"
          : tab === "payments"
            ? "Оплаты акций"
            : tab === "users"
              ? "Пользователи"
              : tab === "settings"
                ? "Настройки"
                : "Поддержка";
    }
    if (sub) {
      sub.textContent =
        tab === "raffles"
          ? "Каталог акций на главной"
          : tab === "payments"
            ? "Проверка чеков и закрепление номерков"
            : tab === "users"
              ? "Все зарегистрированные пользователи"
              : tab === "settings"
                ? "Режим технических работ и параметры сайта"
                : "Пользователи и переписка";
    }

    if (navSupport) navSupport.setAttribute("aria-current", tab === "support" ? "page" : "false");
    if (navUsers) navUsers.setAttribute("aria-current", tab === "users" ? "page" : "false");
    if (navRaffles) navRaffles.setAttribute("aria-current", tab === "raffles" ? "page" : "false");
    if (navPayments) navPayments.setAttribute("aria-current", tab === "payments" ? "page" : "false");
    if (navSettings) navSettings.setAttribute("aria-current", tab === "settings" ? "page" : "false");

    if (tab === "raffles" && typeof window.abInitRaffles === "function") {
      window.abInitRaffles();
    }
    if (tab === "payments" && typeof window.abInitPayments === "function") {
      window.abInitPayments();
    }
    if (tab === "users" && typeof window.abInitUsers === "function") {
      window.abInitUsers();
    }
    if (tab === "settings" && typeof window.abInitSettings === "function") {
      window.abInitSettings();
    }
  }

  function showApp() {
    if (adminLoading) adminLoading.hidden = true;
    if (gate) gate.hidden = true;
    if (adminRoot) adminRoot.hidden = false;
    applyAdminTab();
  }

  /** Из оплат и др.: вкладка «Поддержка», открыть переписку с userId (даже без истории в списке). */
  window.abAdminOpenSupportChat = function (userId) {
    var id = Number(userId);
    if (!Number.isFinite(id)) return;
    try {
      history.replaceState({}, "", "/admin");
    } catch (_) {}
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
      listEl.innerHTML =
        '<p style="padding:16px;color:var(--text-muted);font-size:0.85rem;text-align:center;">Нет диалогов в этой категории</p>';
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
      email: selectedUserData.email,
      role: selectedUserData.role || "user",
      blocked: !!selectedUserData.blocked,
      last_body: null,
      last_at: null,
      last_is_staff: null,
      unread_count: 0,
    });
  }

  async function loadUsers() {
    const data = await apiJson("/api/admin/users", { headers: authHeaders() });
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
    var payload = JSON.stringify({
      type: "typing",
      userId: selectedId,
      active: !!active,
    });
    if (adminWs && adminWs.readyState === WebSocket.OPEN) {
      try {
        adminWs.send(payload);
      } catch (_) {}
    }
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
    const em = document.getElementById("edit-user-email");
    if (n) n.value = selectedUserData.name || "";
    if (p) p.value = formatRuPhone(selectedUserData.phone);
    if (em) em.value = selectedUserData.email || "";
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
      email: user.email || "",
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
      if (threadMeta) {
        threadMeta.textContent =
          formatRuPhone(data.user.phone) + " · " + data.user.email;
      }
      renderMessages(data.messages);
      if (typeof data.user_typing === "boolean") {
        setUserTypingIndicatorVisible(data.user_typing);
      }
      startUserTypingPoll(userId);
      await loadUsers().catch(function () {});
    } finally {
      if (threadLoadUserId === uid) threadLoadUserId = null;
    }
  }

  function authHeaders() {
    const x = loadSession();
    if (!x || !x.token) return {};
    return { Authorization: "Bearer " + x.token };
  }

  /** См. app.js: тот же host что у страницы — прокси Vite /ws → API */
  function buildAdminWebSocketUrl(token) {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + "/ws?token=" + encodeURIComponent(token);
  }

  function disconnectAdminWs() {
    if (adminWs) {
      try {
        adminWs.close();
      } catch (_) {}
      adminWs = null;
    }
  }

  function connectAdminWs() {
    disconnectAdminWs();
    const s = loadSession();
    if (!s || !s.token) return;
    let ws;
    try {
      ws = new WebSocket(buildAdminWebSocketUrl(s.token));
    } catch (_) {
      return;
    }
    adminWs = ws;
    ws.onopen = function () {
      resendAdminTypingFromInput();
    };
    ws.onmessage = function (ev) {
      let d;
      try {
        d = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      if (d.type === "ready") return;
      if (d.type === "typing" && d.from === "user" && d.userId != null) {
        if (selectedId == null || Number(d.userId) !== Number(selectedId)) return;
        setUserTypingIndicatorVisible(!!d.active);
        return;
      }
      if (d.type === "chat_message" && d.message && d.userId != null) {
        loadUsers().catch(function () {});
        if (Number(selectedId) === Number(d.userId)) {
          appendAdminMessage(d.message);
        }
      }
    };
    ws.onclose = function () {
      if (adminWs === ws) adminWs = null;
    };
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

  function isAdminRole(role) {
    return String(role == null ? "" : role)
      .trim()
      .toLowerCase() === "admin";
  }

  async function bootstrap() {
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
        email: me.user.email,
        role: me.user.role != null ? me.user.role : s.role || "user",
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      if (!isAdminRole(merged.role)) {
        if (adminLoading) adminLoading.hidden = true;
        location.replace("/home");
        return;
      }
      showApp();
      init();
    } catch {
      if (adminLoading) adminLoading.hidden = true;
      location.replace("/");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    bootstrap();
  });

  function init() {
    bindTabs();
    connectAdminWs();
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

    if (btnAdminAttach && adminFileInput) {
      btnAdminAttach.addEventListener("click", function () {
        adminFileInput.click();
      });
      adminFileInput.addEventListener("change", function () {
        var f = adminFileInput.files && adminFileInput.files[0];
        if (!f || selectedId == null) return;
        btnAdminAttach.disabled = true;
        var fd = new FormData();
        fd.append("file", f);
        fetch("/api/admin/chat/upload", {
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
            adminFileInput.value = "";
            btnAdminAttach.disabled = false;
          });
      });
    }

    if (form && input) {
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
        clearTimeout(adminTypingDebounceTimer);
        clearTimeout(adminTypingIdleTimer);
        sendAdminTyping(false);
        postAdminChatMessage(text, null)
          .then(function (data) {
            renderMessages(data.messages || []);
            input.value = "";
            loadUsers().catch(function () {});
          })
          .catch(function (err) {
            alert(err.message || "Ошибка отправки");
          });
      });
    }

    const btnEdit = document.getElementById("btn-admin-edit-user");
    if (btnEdit) {
      btnEdit.addEventListener("click", function () {
        openEditModal();
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
        const email = document.getElementById("edit-user-email").value.trim();
        apiJson("/api/admin/users/" + selectedId, {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ name, phone, email }),
        })
          .then(function (data) {
            selectedUserData = data.user;
            if (threadName) threadName.textContent = data.user.name;
            if (threadMeta) {
              threadMeta.textContent =
                formatRuPhone(data.user.phone) + " · " + data.user.email;
            }
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
