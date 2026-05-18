(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";
  const STATUS_LABELS = {
    pending: "Ждёт ответа",
    claimed: "Ответ получен",
    processing: "Ответ получен",
    done: "Готово",
    cancelled: "Отменён",
  };

  let filterStatus = "all";
  let searchQ = "";
  let prizesCache = [];
  let selectedId = null;
  let searchTimer = null;
  const MAX_RECIPIENTS = 20;
  /** @type {{ id: number, name: string, phone: string }[]} */
  let selectedUsers = [];

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
    return "admin-prize-card__status admin-prize-card__status--" + esc(String(s === "processing" ? "claimed" : s || "pending"));
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
        '<button type="button" class="btn btn--primary" id="admin-prize-mark-done"' +
        (p.status === "done" ? " disabled" : "") +
        ">Отметить выполненным</button>" +
        '<button type="button" class="btn btn--danger-outline" id="admin-prize-delete">Удалить</button>' +
        "</div>" +
        "</section>";

      panel.querySelector("[data-user-id]")?.addEventListener("click", function () {
        const uid = Number(panel.querySelector("[data-user-id]")?.getAttribute("data-user-id"));
        if (window.abAdminOpenSupportChat) window.abAdminOpenSupportChat(uid);
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

  function openCreateModal() {
    const modal = document.getElementById("modal-prize-create");
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    const q = document.getElementById("prize-create-user-q");
    if (q && "value" in q) q.value = "";
    const results = document.getElementById("prize-create-user-results");
    if (results) results.innerHTML = "";
    selectedUsers = [];
    renderSelectedUsers();
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
    if (!selectedUsers.length) {
      alert("Добавьте хотя бы одного получателя.");
      return;
    }
    const title = document.getElementById("prize-create-title");
    const intro = document.getElementById("prize-create-intro");
    const hint = document.getElementById("prize-create-hint");
    const t = title && "value" in title ? String(title.value).trim() : "";
    if (!t) {
      alert("Укажите название приза.");
      return;
    }
    const submitBtn = document.getElementById("prize-create-submit");
    if (submitBtn) submitBtn.disabled = true;
    try {
      const data = await apiJson("/api/admin/prizes", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          user_ids: selectedUsers.map(function (u) {
            return u.id;
          }),
          title: t,
          intro_message: intro && "value" in intro ? intro.value : "",
          description: hint && "value" in hint ? hint.value : "",
          send_chat: true,
        }),
      });
      closeCreateModal();
      await loadPrizes();
      let msg = "Отправлено " + String(data.created || selectedUsers.length) + " сообщений в чат.";
      if (data.failed && data.failed.length) {
        msg += " Не удалось для " + data.failed.length + " чел.";
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
