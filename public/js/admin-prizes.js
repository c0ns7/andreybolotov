(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";
  const STATUS_LABELS = {
    pending: "Ожидает ответа",
    claimed: "Данные получены",
    processing: "В обработке",
    done: "Выполнено",
    cancelled: "Отменён",
  };

  let filterStatus = "all";
  let searchQ = "";
  let prizesCache = [];
  let selectedId = null;
  let searchTimer = null;

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
    return "admin-prize-card__status admin-prize-card__status--" + esc(String(s || "pending"));
  }

  function prizeTypeLabel(t) {
    return t === "money" ? "Деньги" : "Приз (доставка)";
  }

  function renderClaimSummary(prize) {
    const c = prize.claim_data;
    if (!c || typeof c !== "object") return '<p class="admin-prize-detail__empty">Пользователь ещё не отправил данные.</p>';
    if (prize.prize_type === "money") {
      if (c.choice === "tickets") {
        const nums = Array.isArray(c.ticket_numbers) ? c.ticket_numbers : [];
        return (
          '<dl class="admin-prize-detail__dl">' +
          "<dt>Выбор</dt><dd>Обмен на номерки</dd>" +
          (prize.raffle_title ? "<dt>Акция</dt><dd>" + esc(prize.raffle_title) + "</dd>" : "") +
          "<dt>Номерки</dt><dd>" +
          esc(nums.length ? nums.map(function (n) { return "№" + n; }).join(", ") : "—") +
          "</dd>" +
          (c.comment ? "<dt>Комментарий</dt><dd>" + esc(String(c.comment)) + "</dd>" : "") +
          "</dl>"
        );
      }
      return (
        '<dl class="admin-prize-detail__dl">' +
        "<dt>Выбор</dt><dd>Получить деньги</dd>" +
        "<dt>Телефон</dt><dd>" +
        esc(formatRuPhone(String(c.phone || ""))) +
        "</dd>" +
        "<dt>Банк</dt><dd>" +
        esc(String(c.bank || "")) +
        "</dd>" +
        "<dt>Получатель</dt><dd>" +
        esc(String(c.recipient_name || "")) +
        "</dd>" +
        (c.comment ? "<dt>Комментарий</dt><dd>" + esc(String(c.comment)) + "</dd>" : "") +
        "</dl>"
      );
    }
    return (
      '<dl class="admin-prize-detail__dl">' +
      "<dt>Получатель</dt><dd>" +
      esc(String(c.recipient_name || "")) +
      "</dd>" +
      "<dt>Адрес</dt><dd>" +
      esc(String(c.address || "")) +
      "</dd>" +
      (c.comment ? "<dt>Комментарий</dt><dd>" + esc(String(c.comment)) + "</dd>" : "") +
      "</dl>"
    );
  }

  function renderList() {
    const list = document.getElementById("admin-prizes-list");
    if (!list) return;
    if (!prizesCache.length) {
      list.innerHTML = '<p class="admin-prizes-empty">Нет призов по выбранному фильтру.</p>';
      return;
    }
    list.innerHTML = prizesCache
      .map(function (p) {
        const active = selectedId === p.id ? " is-active" : "";
        const needs = p.status === "claimed" || p.status === "processing";
        return (
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
          '<span class="admin-prize-card__type">' +
          esc(prizeTypeLabel(p.prize_type)) +
          "</span>" +
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
          "</button>"
        );
      })
      .join("");
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
      const moneyChoice = p.claim_data && p.claim_data.choice === "tickets";
      const receiptBlock =
        p.prize_type === "money" && !moneyChoice
          ? '<section class="admin-prize-detail__section">' +
            "<h4>Чек перевода</h4>" +
            (p.transfer_receipt_url
              ? '<a class="admin-prize-detail__receipt-link" href="' +
                esc(p.transfer_receipt_url) +
                '" target="_blank" rel="noopener">Открыть чек</a>'
              : '<p class="admin-prize-detail__hint">Загрузите чек после перевода.</p>') +
            '<label class="admin-prize-detail__file"><span>Загрузить чек</span><input type="file" id="admin-prize-receipt-file" accept="image/*,application/pdf" /></label>' +
            '<label class="admin-prize-detail__check"><input type="checkbox" id="admin-prize-review-requested"' +
            (p.review_requested ? " checked" : "") +
            " /> Запрошен отзыв в MAX</label>" +
            '<label class="admin-prize-detail__check"><input type="checkbox" id="admin-prize-review-received"' +
            (p.review_received ? " checked" : "") +
            " /> Отзыв получен</label>" +
            '<button type="button" class="btn btn--secondary btn--sm" id="admin-prize-send-receipt-chat">Отправить чек и просьбу об отзыве в чат</button>' +
            "</section>"
          : "";

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
        '<p class="admin-prize-detail__user">' +
        esc(p.user_name) +
        " · " +
        esc(formatRuPhone(p.user_phone)) +
        ' · <button type="button" class="admin-prize-detail__chat-link" data-user-id="' +
        String(p.user_id) +
        '">Открыть чат</button></p>' +
        (p.description ? '<p class="admin-prize-detail__desc">' + esc(p.description) + "</p>" : "") +
        (p.prize_type === "money" && p.money_amount_rub
          ? '<p class="admin-prize-detail__money-sum">Сумма: <strong>' +
            esc(String(p.money_amount_rub)) +
            " ₽</strong>" +
            (p.allows_ticket_exchange
              ? " · можно обменять на " + esc(String(p.exchange_ticket_count || 0)) + " ном."
              : "") +
            "</p>"
          : "") +
        '<section class="admin-prize-detail__section"><h4>Данные от пользователя</h4>' +
        renderClaimSummary(p) +
        "</section>" +
        receiptBlock +
        '<section class="admin-prize-detail__section">' +
        "<h4>Заметки администратора</h4>" +
        '<textarea id="admin-prize-notes" class="input" rows="3" placeholder="Внутренние заметки…">' +
        esc(p.admin_notes || "") +
        "</textarea>" +
        '<label class="admin-prize-detail__select-label">Статус<select id="admin-prize-status" class="input">' +
        ["pending", "claimed", "processing", "done", "cancelled"]
          .map(function (s) {
            return (
              '<option value="' + s + '"' + (p.status === s ? " selected" : "") + ">" + esc(STATUS_LABELS[s]) + "</option>"
            );
          })
          .join("") +
        "</select></label>" +
        '<div class="admin-prize-detail__actions">' +
        '<button type="button" class="btn btn--primary" id="admin-prize-save">Сохранить</button>' +
        '<button type="button" class="btn btn--secondary" id="admin-prize-mark-done">Отметить выполненным</button>' +
        "</div>" +
        "</section>";

      panel.querySelector("[data-user-id]")?.addEventListener("click", function () {
        const uid = Number(panel.querySelector("[data-user-id]")?.getAttribute("data-user-id"));
        if (window.abAdminOpenSupportChat) window.abAdminOpenSupportChat(uid);
      });
      document.getElementById("admin-prize-save")?.addEventListener("click", function () {
        void saveDetail(p.id, false);
      });
      document.getElementById("admin-prize-mark-done")?.addEventListener("click", function () {
        void saveDetail(p.id, true);
      });
      document.getElementById("admin-prize-send-receipt-chat")?.addEventListener("click", function () {
        void sendReceiptChat(p.id);
      });
      document.getElementById("admin-prize-receipt-file")?.addEventListener("change", function (e) {
        const f = e.target && e.target.files && e.target.files[0];
        if (f) void uploadReceipt(p.id, f);
      });
    } catch (err) {
      panel.innerHTML = '<p class="admin-prizes-empty is-error">' + esc(err.message || "Ошибка") + "</p>";
    }
  }

  async function saveDetail(id, markDone) {
    const notes = document.getElementById("admin-prize-notes");
    const statusEl = document.getElementById("admin-prize-status");
    const reviewReq = document.getElementById("admin-prize-review-requested");
    const reviewRec = document.getElementById("admin-prize-review-received");
    const payload = {
      admin_notes: notes && "value" in notes ? notes.value : "",
      status: statusEl && "value" in statusEl ? statusEl.value : undefined,
      mark_done: markDone,
    };
    if (reviewReq) payload.review_requested = reviewReq.checked;
    if (reviewRec) payload.review_received = reviewRec.checked;
    await apiJson("/api/admin/prizes/" + id, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    await loadPrizes();
    alert(markDone ? "Приз отмечен как выполненный." : "Сохранено.");
  }

  async function uploadReceipt(id, file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/prizes/upload-receipt", {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
    await apiJson("/api/admin/prizes/" + id, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({
        transfer_receipt_url: data.url,
        transfer_receipt_name: file.name,
        transfer_receipt_mime: data.mime,
      }),
    });
    await openDetail(id, true);
  }

  async function sendReceiptChat(id) {
    await apiJson("/api/admin/prizes/" + id + "/send-receipt-chat", {
      method: "POST",
      headers: authHeaders(),
    });
    alert("Сообщение с чеком отправлено в чат пользователя.");
    await openDetail(id, true);
  }

  let rafflesForPrizeCache = null;

  function syncPrizeCreateMoneyFields() {
    const typeEl = document.getElementById("prize-create-type");
    const moneyBlock = document.getElementById("prize-create-money-fields");
    const exchangeBlock = document.getElementById("prize-create-exchange-fields");
    const allows = document.getElementById("prize-create-allows-exchange");
    const isMoney = typeEl && "value" in typeEl && typeEl.value === "money";
    if (moneyBlock) moneyBlock.hidden = !isMoney;
    const allowExchange = isMoney && allows && "checked" in allows && allows.checked;
    if (exchangeBlock) exchangeBlock.hidden = !allowExchange;
  }

  async function loadRafflesForPrizeCreate() {
    if (rafflesForPrizeCache) return rafflesForPrizeCache;
    const data = await apiJson("/api/admin/raffles", { headers: authHeaders() });
    rafflesForPrizeCache = Array.isArray(data.raffles) ? data.raffles : [];
    const sel = document.getElementById("prize-create-raffle-id");
    if (sel) {
      const cur = sel.value;
      sel.innerHTML =
        '<option value="">— выберите акцию —</option>' +
        rafflesForPrizeCache
          .map(function (r) {
            return (
              '<option value="' +
              String(r.id) +
              '">' +
              esc(String(r.title || "Акция " + r.id)) +
              "</option>"
            );
          })
          .join("");
      if (cur) sel.value = cur;
    }
    return rafflesForPrizeCache;
  }

  function openCreateModal() {
    const modal = document.getElementById("modal-prize-create");
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    const phone = document.getElementById("prize-create-user-q");
    if (phone && "value" in phone) phone.value = "";
    const results = document.getElementById("prize-create-user-results");
    if (results) results.innerHTML = "";
    const hidden = document.getElementById("prize-create-user-id");
    if (hidden && "value" in hidden) hidden.value = "";
    createUserId = null;
    syncPrizeCreateMoneyFields();
    void loadRafflesForPrizeCreate().catch(function () {});
  }

  function closeCreateModal() {
    const modal = document.getElementById("modal-prize-create");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  let createUserId = null;

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
          " · ID " +
          String(u.id) +
          "</button>"
        );
      })
      .join("");
    box.querySelectorAll(".admin-prize-user-pick").forEach(function (btn) {
      btn.addEventListener("click", function () {
        createUserId = Number(btn.getAttribute("data-id"));
        const hidden = document.getElementById("prize-create-user-id");
        if (hidden) hidden.value = String(createUserId);
        const picked = document.getElementById("prize-create-user-picked");
        if (picked) {
          picked.textContent = "Выбран: " + btn.getAttribute("data-name") + " (" + btn.getAttribute("data-phone") + ")";
          picked.hidden = false;
        }
        box.innerHTML = "";
      });
    });
  }

  async function submitCreate() {
    const uid = createUserId || Number(document.getElementById("prize-create-user-id")?.value);
    if (!Number.isFinite(uid)) {
      alert("Выберите пользователя из поиска.");
      return;
    }
    const title = document.getElementById("prize-create-title");
    const typeEl = document.getElementById("prize-create-type");
    const intro = document.getElementById("prize-create-intro");
    const desc = document.getElementById("prize-create-desc");
    const t = title && "value" in title ? String(title.value).trim() : "";
    if (!t) {
      alert("Укажите название приза.");
      return;
    }
    const prizeType = typeEl && "value" in typeEl ? typeEl.value : "physical";
    const payload = {
      user_id: uid,
      title: t,
      description: desc && "value" in desc ? desc.value : "",
      prize_type: prizeType,
      intro_message: intro && "value" in intro ? intro.value : "",
      send_chat: true,
    };
    if (prizeType === "money") {
      const amountEl = document.getElementById("prize-create-money-amount");
      const allowsEl = document.getElementById("prize-create-allows-exchange");
      const raffleEl = document.getElementById("prize-create-raffle-id");
      const countEl = document.getElementById("prize-create-exchange-count");
      payload.money_amount_rub = amountEl && "value" in amountEl ? Number(amountEl.value) || 0 : 0;
      payload.allows_ticket_exchange = !!(allowsEl && "checked" in allowsEl && allowsEl.checked);
      if (payload.allows_ticket_exchange) {
        payload.raffle_id = raffleEl && "value" in raffleEl ? Number(raffleEl.value) : 0;
        payload.exchange_ticket_count = countEl && "value" in countEl ? Number(countEl.value) || 1 : 1;
        if (!Number.isFinite(payload.raffle_id) || payload.raffle_id < 1) {
          alert("Выберите акцию для обмена на номерки.");
          return;
        }
      }
    }
    await apiJson("/api/admin/prizes", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    closeCreateModal();
    await loadPrizes();
    alert("Приз создан. Пользователю отправлено сообщение в чат с кнопкой «Забрать приз».");
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
    document.getElementById("prize-create-type")?.addEventListener("change", syncPrizeCreateMoneyFields);
    document.getElementById("prize-create-allows-exchange")?.addEventListener("change", syncPrizeCreateMoneyFields);

    document.getElementById("prize-create-user-q")?.addEventListener("input", function (e) {
      const v = e.target && "value" in e.target ? e.target.value : "";
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        void searchUsersForPrize(v).catch(function () {});
      }, 280);
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
