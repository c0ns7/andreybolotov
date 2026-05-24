(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";
  const STATUS_LABELS = {
    pending: "Ждёт ответа",
    claimed: "Ответ получен",
    processing: "На выполнении",
    done: "Готово",
    cancelled: "Отменён",
  };

  let filterStatus = "all";
  let searchQ = "";
  let prizesCache = [];
  let selectedId = null;
  let searchTimer = null;
  const MAX_RECIPIENTS = 20;
  let selectedUsers = [];
  let chatModalUserId = null;
  let chatModalPrizeTitle = "";
  let rafflesCache = [];
  let ticketPreviewTimer = null;

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

  function authHeaders() {
    const x = loadSession();
    if (!x || !x.token) return {};
    return { Authorization: "Bearer " + x.token };
  }

  async function apiJson(path, options) {
    const opts = options || {};
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const res = await fetch(path, { ...opts, headers, cache: opts.cache !== undefined ? opts.cache : "no-store" });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || data.message || "Ошибка запроса");
    return data;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatRuPhone(phone) {
    const d = String(phone).replace(/\D/g, "");
    if (d.length !== 11) return phone;
    return "+7 (" + d.slice(1, 4) + ") " + d.slice(4, 7) + "-" + d.slice(7, 9) + "-" + d.slice(9, 11);
  }

  function formatDateTime(ts) {
    const d = new Date(Number(ts));
    return (
      String(d.getDate()).padStart(2, "0") +
      "." +
      String(d.getMonth() + 1).padStart(2, "0") +
      "." +
      d.getFullYear() +
      " " +
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  function statusClass(s) {
    const key = s === "processing" ? "processing" : s || "pending";
    return "admin-prize-card__status admin-prize-card__status--" + esc(key);
  }

  function groupPrizesByRaffle(list) {
    const groups = [];
    const map = new Map();
    list.forEach(function (p) {
      const key = p.raffle_id ? String(p.raffle_id) : "none";
      const title = p.raffle_title || (p.raffle_id ? "Акция #" + p.raffle_id : "Без акции");
      if (!map.has(key)) {
        map.set(key, { key: key, title: title, items: [] });
        groups.push(map.get(key));
      }
      map.get(key).items.push(p);
    });
    return groups;
  }

  function renderResponse(prize) {
    const text = String(prize.response_message || "").trim();
    if (!text) {
      return '<p class="admin-prize-detail__empty">Пользователь ещё не отправил ответ.</p>';
    }
    return (
      '<div class="admin-prize-detail__response">' +
      '<p class="admin-prize-detail__response-text">' +
      esc(text).replace(/\n/g, "<br>") +
      "</p>" +
      (prize.claimed_at ? '<p class="admin-prize-detail__response-meta">Отправлено: ' + esc(formatDateTime(prize.claimed_at)) + "</p>" : "") +
      "</div>"
    );
  }

  function renderList() {
    const list = document.getElementById("admin-prizes-list");
    if (!list) return;
    if (!prizesCache.length) {
      list.innerHTML = '<p class="admin-prizes-empty">Нет призов по выбранному фильтру.</p>';
      return;
    }
    const groups = groupPrizesByRaffle(prizesCache);
    let html = "";
    groups.forEach(function (group) {
      html +=
        '<div class="admin-prizes-raffle-group">' +
        '<h3 class="admin-prizes-raffle-group__title">' +
        esc(group.title) +
        '<span class="admin-prizes-raffle-group__count">' +
        String(group.items.length) +
        "</span></h3>" +
        '<div class="admin-prizes-raffle-group__list">';
      group.items.forEach(function (p) {
        const active = selectedId === p.id ? " is-active" : "";
        const needs = p.status === "claimed" || p.status === "processing";
        const ticket =
          p.ticket_number != null && p.ticket_number !== ""
            ? '<span class="admin-prize-card__ticket">№' + esc(String(p.ticket_number)) + "</span>"
            : "";
        html +=
          '<button type="button" class="admin-prize-card' +
          active +
          (needs ? " admin-prize-card--attention" : "") +
          '" data-prize-id="' +
          String(p.id) +
          '">' +
          '<div class="admin-prize-card__top">' +
          '<span class="' +
          statusClass(p.status) +
          '">' +
          esc(STATUS_LABELS[p.status] || p.status) +
          "</span>" +
          ticket +
          "</div>" +
          '<h3 class="admin-prize-card__title">' +
          esc(p.title) +
          "</h3>" +
          '<p class="admin-prize-card__user">' +
          esc(p.user_name || "—") +
          " · " +
          esc(formatRuPhone(p.user_phone || "")) +
          "</p>" +
          '<p class="admin-prize-card__meta">' +
          (p.claimed_at ? "Ответ: " + esc(formatDateTime(p.claimed_at)) : "Создан: " + esc(formatDateTime(p.created_at))) +
          "</p>" +
          "</button>";
      });
      html += "</div></div>";
    });
    list.innerHTML = html;
  }

  async function loadPrizes() {
    const list = document.getElementById("admin-prizes-list");
    if (list) list.innerHTML = '<p class="admin-prizes-empty">Загрузка…</p>';
    const data = await apiJson(
      "/api/admin/prizes?status=" + encodeURIComponent(filterStatus) + "&q=" + encodeURIComponent(searchQ) + "&limit=60",
      { headers: authHeaders() },
    );
    prizesCache = Array.isArray(data.prizes) ? data.prizes : [];
    renderList();
    if (selectedId) void openDetail(selectedId, true);
  }

  async function openDetail(id, silent) {
    selectedId = id;
    renderList();
    const panel = document.getElementById("admin-prize-detail");
    if (!panel) return;
    if (!silent) panel.innerHTML = '<p class="admin-prizes-empty">Загрузка…</p>';
    try {
      const data = await apiJson("/api/admin/prizes/" + id, { headers: authHeaders() });
      const p = data.prize;
      if (!p) throw new Error("Не найдено");

      panel.innerHTML =
        '<div class="admin-prize-detail__head">' +
        "<h3>" +
        esc(p.title) +
        "</h3>" +
        '<span class="' +
        statusClass(p.status) +
        '">' +
        esc(STATUS_LABELS[p.status] || p.status) +
        "</span>" +
        "</div>" +
        (p.raffle_title || p.ticket_number
          ? '<p class="admin-prize-detail__raffle">' +
            esc(p.raffle_title || "Акция") +
            (p.ticket_number ? " · номерок №" + esc(String(p.ticket_number)) : "") +
            "</p>"
          : "") +
        '<p class="admin-prize-detail__user">' +
        esc(p.user_name) +
        " · " +
        esc(formatRuPhone(p.user_phone)) +
        ' · <button type="button" class="admin-prize-detail__chat-link" data-user-id="' +
        String(p.user_id) +
        '" data-prize-title="' +
        esc(p.title) +
        '">Чат</button></p>' +
        (p.description
          ? '<section class="admin-prize-detail__section"><h4>Сообщение пользователю</h4><p class="admin-prize-detail__hint">' +
            esc(p.description) +
            "</p></section>"
          : "") +
        '<section class="admin-prize-detail__section admin-prize-detail__section--response"><h4>Ответ пользователя</h4>' +
        renderResponse(p) +
        "</section>" +
        '<section class="admin-prize-detail__section admin-prize-detail__section--actions">' +
        '<div class="admin-prize-detail__actions">' +
        (p.status !== "processing" && p.status !== "done"
          ? '<button type="button" class="btn btn--secondary" id="admin-prize-set-processing">На выполнение</button>'
          : "") +
        '<button type="button" class="btn btn--primary" id="admin-prize-mark-done"' +
        (p.status === "done" ? " disabled" : "") +
        ">Отметить выполненным</button>" +
        '<button type="button" class="btn btn--danger-outline" id="admin-prize-delete">Удалить</button>' +
        "</div>" +
        "</section>";

      panel.querySelector("[data-user-id]")?.addEventListener("click", function () {
        const btn = panel.querySelector("[data-user-id]");
        const uid = Number(btn?.getAttribute("data-user-id"));
        const title = btn?.getAttribute("data-prize-title") || p.title;
        openPrizeChatModal(uid, title, p.user_name, p.user_phone);
      });
      document.getElementById("admin-prize-set-processing")?.addEventListener("click", function () {
        void setProcessing(p.id);
      });
      document.getElementById("admin-prize-mark-done")?.addEventListener("click", function () {
        void markDone(p.id);
      });
      document.getElementById("admin-prize-delete")?.addEventListener("click", function () {
        void removePrize(p.id);
      });
    } catch (err) {
      panel.innerHTML = '<p class="admin-prizes-empty is-error">' + esc(err.message || "Ошибка") + "</p>";
    }
  }

  async function setProcessing(id) {
    await apiJson("/api/admin/prizes/" + id, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ status: "processing" }),
    });
    await loadPrizes();
    await openDetail(id, true);
  }

  async function markDone(id) {
    await apiJson("/api/admin/prizes/" + id, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ mark_done: true }),
    });
    await loadPrizes();
    await openDetail(id, true);
  }

  async function removePrize(id) {
    if (!confirm("Удалить приз без восстановления? Сообщение в чате тоже будет удалено.")) return;
    try {
      await apiJson("/api/admin/prizes/" + id, {
        method: "DELETE",
        headers: authHeaders(),
      });
      selectedId = null;
      const panel = document.getElementById("admin-prize-detail");
      if (panel) {
        panel.innerHTML =
          '<p class="admin-prizes-empty admin-prizes-empty--placeholder">' +
          '<span class="admin-prizes-empty__icon" aria-hidden="true">🎁</span>' +
          '<span class="admin-prizes-empty__title">Выберите приз</span>' +
          '<span class="admin-prizes-empty__text">Нажмите на карточку слева, чтобы увидеть ответ пользователя и действия.</span>' +
          "</p>";
      }
      await loadPrizes();
    } catch (err) {
      alert(err.message || "Не удалось удалить");
    }
  }

  function renderSelectedUsers() {
    const box = document.getElementById("prize-create-users-selected");
    if (!box) return;
    if (!selectedUsers.length) {
      box.innerHTML = '<p class="admin-prize-create-users-empty">Пока никого не выбрано. Найдите и добавьте победителей из поиска.</p>';
      return;
    }
    box.innerHTML =
      '<p class="admin-prize-create-users-count">Выбрано: ' +
      String(selectedUsers.length) +
      " / " +
      String(MAX_RECIPIENTS) +
      '</p><ul class="admin-prize-create-users-chips">' +
      selectedUsers
        .map(function (u) {
          return (
            '<li class="admin-prize-create-user-chip">' +
            '<span class="admin-prize-create-user-chip__text">' +
            esc(u.name) +
            " · " +
            esc(formatRuPhone(u.phone)) +
            "</span>" +
            '<button type="button" class="admin-prize-create-user-chip__remove" data-remove-id="' +
            String(u.id) +
            '" aria-label="Убрать">×</button>' +
            "</li>"
          );
        })
        .join("") +
      "</ul>";
    box.querySelectorAll("[data-remove-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const id = Number(btn.getAttribute("data-remove-id"));
        selectedUsers = selectedUsers.filter(function (u) {
          return u.id !== id;
        });
        renderSelectedUsers();
      });
    });
  }

  function addSelectedUser(u) {
    const id = Math.floor(Number(u.id));
    if (!Number.isFinite(id)) return;
    if (selectedUsers.some(function (x) {
      return x.id === id;
    })) {
      alert("Этот пользователь уже в списке.");
      return;
    }
    if (selectedUsers.length >= MAX_RECIPIENTS) {
      alert("Можно выбрать не больше " + MAX_RECIPIENTS + " человек за раз.");
      return;
    }
    selectedUsers.push({
      id: id,
      name: String(u.name || ""),
      phone: String(u.phone || ""),
    });
    renderSelectedUsers();
    const q = document.getElementById("prize-create-user-q");
    if (q && "value" in q) q.value = "";
    const results = document.getElementById("prize-create-user-results");
    if (results) results.innerHTML = "";
  }

  function formatChatTime(ts) {
    const d = new Date(Number(ts));
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

  function renderChatModalMessages(messages) {
    const box = document.getElementById("modal-prize-chat-messages");
    if (!box) return;
    if (!messages || !messages.length) {
      box.innerHTML = '<p class="admin-prize-chat-empty">Нет сообщений</p>';
      return;
    }
    box.innerHTML = messages
      .map(function (m) {
        const staff = !!m.is_staff;
        return (
          '<div class="admin-prize-chat-msg admin-prize-chat-msg--' +
          (staff ? "staff" : "user") +
          '">' +
          '<div class="admin-prize-chat-msg__meta">' +
          (staff ? "Поддержка" : "Пользователь") +
          " · " +
          esc(formatChatTime(m.created_at)) +
          "</div>" +
          '<div class="admin-prize-chat-msg__body">' +
          esc(String(m.body || "").replace(/\[\[AB_CARD:[^\]]+\]\]\s*$/m, "").trim()).replace(/\n/g, "<br>") +
          "</div></div>"
        );
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  async function loadChatModalMessages(userId) {
    const data = await apiJson("/api/admin/users/" + String(userId) + "/messages", { headers: authHeaders() });
    renderChatModalMessages(data.messages || []);
  }

  function openPrizeChatModal(userId, prizeTitle, userName, userPhone) {
    const modal = document.getElementById("modal-prize-chat");
    if (!modal) return;
    chatModalUserId = Number(userId);
    chatModalPrizeTitle = String(prizeTitle || "");
    const sub = document.getElementById("modal-prize-chat-sub");
    if (sub) {
      sub.textContent =
        String(userName || "") + " · " + formatRuPhone(userPhone || "") + (prizeTitle ? " · «" + prizeTitle + "»" : "");
    }
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    const box = document.getElementById("modal-prize-chat-messages");
    if (box) box.innerHTML = '<p class="admin-prize-chat-empty">Загрузка…</p>';
    void loadChatModalMessages(chatModalUserId).catch(function (e) {
      if (box) box.innerHTML = '<p class="admin-prize-chat-empty is-error">' + esc(e.message || "Ошибка") + "</p>";
    });
  }

  function closePrizeChatModal() {
    const modal = document.getElementById("modal-prize-chat");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    chatModalUserId = null;
    chatModalPrizeTitle = "";
  }

  async function sendChatModalMessage(text) {
    if (!chatModalUserId) return;
    const body = String(text || "").trim();
    if (!body) return;
    await apiJson("/api/admin/users/" + String(chatModalUserId) + "/messages", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ body: body }),
    });
    await loadChatModalMessages(chatModalUserId);
  }

  async function loadRafflesForCreate() {
    if (rafflesCache.length) return rafflesCache;
    const data = await apiJson("/api/admin/raffles", { headers: authHeaders() });
    rafflesCache = Array.isArray(data.raffles) ? data.raffles : [];
    return rafflesCache;
  }

  function fillRaffleSelect() {
    const sel = document.getElementById("prize-create-raffle");
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">— выберите акцию —</option>';
    rafflesCache.forEach(function (r) {
      const opt = document.createElement("option");
      opt.value = String(r.id);
      opt.textContent = String(r.title || "Акция #" + r.id);
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  }

  async function previewTicketHolders() {
    const preview = document.getElementById("prize-create-tickets-preview");
    const sel = document.getElementById("prize-create-raffle");
    const tickets = document.getElementById("prize-create-tickets");
    if (!preview || !sel || !tickets) return;
    const raffleId = Math.floor(Number(sel.value));
    const nums = String(tickets.value || "").trim();
    if (!Number.isFinite(raffleId) || raffleId < 1 || !nums) {
      preview.innerHTML = "";
      return;
    }
    preview.innerHTML = '<p class="admin-prize-create-tickets-preview__loading">Проверка номерков…</p>';
    try {
      const data = await apiJson(
        "/api/admin/prizes/ticket-holders/preview?raffle_id=" +
          encodeURIComponent(String(raffleId)) +
          "&ticket_numbers=" +
          encodeURIComponent(nums),
        { headers: authHeaders() },
      );
      const holders = data.holders || [];
      const notFound = data.not_found || [];
      let html = "";
      if (holders.length) {
        html +=
          '<p class="admin-prize-create-tickets-preview__ok">Найдено ' +
          String(holders.length) +
          ':</p><ul class="admin-prize-create-tickets-preview__list">';
        holders.forEach(function (h) {
          html +=
            "<li>№" +
            esc(String(h.ticket_number)) +
            " — " +
            esc(h.user_name) +
            " · " +
            esc(formatRuPhone(h.user_phone)) +
            "</li>";
        });
        html += "</ul>";
      }
      if (notFound.length) {
        html +=
          '<p class="admin-prize-create-tickets-preview__warn">Не найдены: ' +
          notFound.map(function (n) {
            return "№" + n;
          }).join(", ") +
          "</p>";
      }
      if (!html) html = '<p class="admin-prize-create-tickets-preview__warn">Номерки не распознаны</p>';
      preview.innerHTML = html;
    } catch (e) {
      preview.innerHTML = '<p class="admin-prize-create-tickets-preview__warn">' + esc(e.message || "Ошибка") + "</p>";
    }
  }

  function openCreateModal() {
    const modal = document.getElementById("modal-prize-create");
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    const q = document.getElementById("prize-create-user-q");
    if (q && "value" in q) q.value = "";
    const tickets = document.getElementById("prize-create-tickets");
    if (tickets && "value" in tickets) tickets.value = "";
    const preview = document.getElementById("prize-create-tickets-preview");
    if (preview) preview.innerHTML = "";
    const results = document.getElementById("prize-create-user-results");
    if (results) results.innerHTML = "";
    selectedUsers = [];
    renderSelectedUsers();
    void loadRafflesForCreate()
      .then(function () {
        fillRaffleSelect();
      })
      .catch(function () {});
  }

  function closeCreateModal() {
    const modal = document.getElementById("modal-prize-create");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  async function searchUsersForPrize(q) {
    const box = document.getElementById("prize-create-user-results");
    if (!box) return;
    const qq = String(q || "").trim();
    if (qq.length < 2) {
      box.innerHTML = "";
      return;
    }
    const data = await apiJson("/api/admin/users/all?limit=8&q=" + encodeURIComponent(qq), {
      headers: authHeaders(),
    });
    const users = data.users || [];
    if (!users.length) {
      box.innerHTML = '<p class="admin-prizes-empty">Никого не найдено</p>';
      return;
    }
    box.innerHTML = users
      .map(function (u) {
        return (
          '<button type="button" class="admin-prize-user-pick" data-id="' +
          String(u.id) +
          '" data-name="' +
          esc(u.name) +
          '" data-phone="' +
          esc(u.phone) +
          '">' +
          esc(u.name) +
          " · " +
          esc(formatRuPhone(u.phone)) +
          "</button>"
        );
      })
      .join("");
    box.querySelectorAll(".admin-prize-user-pick").forEach(function (btn) {
      btn.addEventListener("click", function () {
        addSelectedUser({
          id: Number(btn.getAttribute("data-id")),
          name: btn.getAttribute("data-name"),
          phone: btn.getAttribute("data-phone"),
        });
      });
    });
  }

  async function submitCreate() {
    const title = document.getElementById("prize-create-title");
    const intro = document.getElementById("prize-create-intro");
    const hint = document.getElementById("prize-create-hint");
    const raffleSel = document.getElementById("prize-create-raffle");
    const ticketsEl = document.getElementById("prize-create-tickets");
    const t = title && "value" in title ? String(title.value).trim() : "";
    if (!t) {
      alert("Укажите название приза.");
      return;
    }

    const raffleId = raffleSel && "value" in raffleSel ? Math.floor(Number(raffleSel.value)) : NaN;
    const ticketText = ticketsEl && "value" in ticketsEl ? String(ticketsEl.value).trim() : "";
    const useTickets = Number.isFinite(raffleId) && raffleId > 0 && ticketText;

    if (!useTickets && !selectedUsers.length) {
      alert("Выберите акцию с номерками или добавьте получателей вручную.");
      return;
    }

    const submitBtn = document.getElementById("prize-create-submit");
    if (submitBtn) submitBtn.disabled = true;
    try {
      const payload = {
        title: t,
        intro_message: intro && "value" in intro ? intro.value : "",
        description: hint && "value" in hint ? hint.value : "",
        send_chat: true,
      };
      if (useTickets) {
        payload.raffle_id = raffleId;
        payload.ticket_numbers = ticketText;
      } else {
        payload.user_ids = selectedUsers.map(function (u) {
          return u.id;
        });
      }
      const data = await apiJson("/api/admin/prizes", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      closeCreateModal();
      await loadPrizes();
      let msg = "Отправлено " + String(data.created || (useTickets ? 0 : selectedUsers.length)) + " призов в чат.";
      if (data.not_found && data.not_found.length) {
        msg += " Не найдены номерки: " + data.not_found.join(", ") + ".";
      }
      if (data.failed && data.failed.length) {
        msg += " Ошибки: " + data.failed.length + ".";
      }
      alert(msg);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function bindOnce() {
    if (window.__abPrizesInited) return;
    window.__abPrizesInited = true;

    document.getElementById("btn-prize-create")?.addEventListener("click", openCreateModal);
    document.getElementById("modal-prize-create-close")?.addEventListener("click", closeCreateModal);
    document.getElementById("modal-prize-create-backdrop")?.addEventListener("click", closeCreateModal);
    document.getElementById("prize-create-submit")?.addEventListener("click", function () {
      void submitCreate().catch(function (e) {
        alert(e.message || "Ошибка");
      });
    });

    document.getElementById("prize-create-user-q")?.addEventListener("input", function (e) {
      const v = e.target && "value" in e.target ? e.target.value : "";
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        void searchUsersForPrize(v).catch(function () {});
      }, 280);
    });

    document.getElementById("prize-create-raffle")?.addEventListener("change", function () {
      void previewTicketHolders();
    });
    document.getElementById("prize-create-tickets")?.addEventListener("input", function () {
      if (ticketPreviewTimer) clearTimeout(ticketPreviewTimer);
      ticketPreviewTimer = setTimeout(function () {
        void previewTicketHolders();
      }, 400);
    });

    document.getElementById("modal-prize-chat-close")?.addEventListener("click", closePrizeChatModal);
    document.getElementById("modal-prize-chat-backdrop")?.addEventListener("click", closePrizeChatModal);
    document.getElementById("modal-prize-chat-form")?.addEventListener("submit", function (e) {
      e.preventDefault();
      const inp = document.getElementById("modal-prize-chat-input");
      const text = inp && "value" in inp ? String(inp.value).trim() : "";
      if (!text) return;
      const btn = document.getElementById("modal-prize-chat-send");
      if (btn) btn.disabled = true;
      void sendChatModalMessage(text)
        .then(function () {
          if (inp && "value" in inp) inp.value = "";
        })
        .catch(function (err) {
          alert(err.message || "Не удалось отправить");
        })
        .finally(function () {
          if (btn) btn.disabled = false;
        });
    });

    document.querySelectorAll(".admin-prizes-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".admin-prizes-tab").forEach(function (t) {
          t.classList.remove("is-active");
          t.setAttribute("aria-selected", "false");
        });
        tab.classList.add("is-active");
        tab.setAttribute("aria-selected", "true");
        filterStatus = tab.getAttribute("data-status") || "all";
        void loadPrizes();
      });
    });

    document.getElementById("admin-prizes-search")?.addEventListener("input", function (e) {
      searchQ = e.target && "value" in e.target ? e.target.value : "";
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        void loadPrizes();
      }, 300);
    });

    document.getElementById("admin-prizes-list")?.addEventListener("click", function (e) {
      const card = e.target && e.target.closest && e.target.closest(".admin-prize-card");
      if (!card) return;
      const id = Number(card.getAttribute("data-prize-id"));
      if (Number.isFinite(id)) void openDetail(id);
    });
  }

  window.abInitPrizes = function () {
    bindOnce();
    void loadPrizes().catch(function (err) {
      const list = document.getElementById("admin-prizes-list");
      if (list) list.innerHTML = '<p class="admin-prizes-empty is-error">' + esc(err.message || "Ошибка") + "</p>";
    });
  };
})();
