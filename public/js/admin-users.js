(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";

  const ICO = {
    edit:
      '<svg class="admin-user-card__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
    chat:
      '<svg class="admin-user-card__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    crown:
      '<svg class="admin-user-card__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 17l10 5 10-5M12 22V12"></path><path d="m2 9 5 3 5-3 5 3 5-3"></path><path d="M12 2 7 7l5 3 5-3-5-5z"></path></svg>',
    userDown:
      '<svg class="admin-user-card__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="m22 11-4 4-4-4M14 15V3"></path></svg>',
    ban:
      '<svg class="admin-user-card__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>',
    unlock:
      '<svg class="admin-user-card__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>',
    trash:
      '<svg class="admin-user-card__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
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

  function authHeaders() {
    const x = loadSession();
    if (!x || !x.token) return {};
    return { Authorization: "Bearer " + x.token };
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

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
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

  /** @type {Array<{id:number;phone:string;name:string;locality?:string;role:string;blocked:boolean;created_at:number;last_active_at:number|null}>} */
  let usersCache = [];
  let usersTotal = 0;
  let listLoading = false;
  /** Увеличивается при каждом «сбросе» списка (поиск / перезагрузка), чтобы отбрасывать ответы устаревших запросов (в т.ч. догрузки по скроллу). */
  let fetchGeneration = 0;
  let currentSearch = "";
  /** Только цифры, точный id; если непусто — запрос с `id=`, текстовый `q` не шлём */
  let currentIdSearch = "";
  /** @type {IntersectionObserver | null} */
  let ioObserver = null;
  const PAGE_SIZE = 10;

  function updateUsersTotalHeading() {
    const el = document.getElementById("admin-users-total-count");
    if (!el) return;
    el.textContent = "(" + String(usersTotal) + ")";
  }

  function disconnectUsersIo() {
    if (ioObserver) {
      ioObserver.disconnect();
      ioObserver = null;
    }
  }

  function setupInfiniteScroll() {
    const root = document.getElementById("admin-users-list");
    const sent = document.getElementById("admin-users-io-sentinel");
    if (!root || !sent) return;
    disconnectUsersIo();
    ioObserver = new IntersectionObserver(
      function (entries) {
        for (let i = 0; i < entries.length; i++) {
          const en = entries[i];
          if (!en.isIntersecting || listLoading) continue;
          if (usersCache.length >= usersTotal) return;
          fetchUsersPage(false).catch(function (e) {
            if (e.status === 403 || e.status === 401) {
              location.replace(e.status === 401 ? "/" : "/home");
              return;
            }
            alert(e.message || "Ошибка загрузки");
          });
          return;
        }
      },
      { root: root, rootMargin: "140px", threshold: 0 },
    );
    ioObserver.observe(sent);
  }

  function renderUsers() {
    const el = document.getElementById("admin-users-list");
    if (!el) return;
    disconnectUsersIo();

    if (listLoading && usersCache.length === 0) {
      el.innerHTML = '<p class="admin-users-empty admin-users-empty--loading">Загрузка…</p>';
      return;
    }

    if (!usersCache.length) {
      el.innerHTML = '<p class="admin-users-empty">Нет пользователей по фильтру</p>';
      return;
    }

    const hasMore = usersCache.length < usersTotal;
    const sentinel = hasMore
      ? '<div id="admin-users-io-sentinel" class="admin-users-io-sentinel" aria-hidden="true"></div>'
      : "";
    const loadingMore =
      listLoading && usersCache.length > 0
        ? '<p class="admin-users-loading-more">Загрузка…</p>'
        : "";

    el.innerHTML =
      '<div class="admin-users-grid" role="list">' +
      usersCache
        .map(function (u) {
          var roleLabel = u.role === "admin" ? "Админ" : "Пользователь";
          var stLabel = u.blocked ? "Заблокирован" : "Активен";
          var stClass = u.blocked ? "admin-user-card__status--blocked" : "admin-user-card__status--ok";
          var lastActiveLabel = formatLastActive(u.last_active_at);
          var letter = String(u.name || "?").trim().charAt(0).toUpperCase() || "?";
          var roleBtn =
            u.role === "admin"
              ? '<button type="button" class="admin-user-card__icon-btn admin-user-card__icon-btn--muted" data-demote="' +
                u.id +
                '" title="Снять админа" aria-label="Снять админа">' +
                ICO.userDown +
                "</button>"
              : '<button type="button" class="admin-user-card__icon-btn admin-user-card__icon-btn--accent" data-promote="' +
                u.id +
                '" title="Админ" aria-label="Сделать админом">' +
                ICO.crown +
                "</button>";
          var blockBtn = u.blocked
            ? '<button type="button" class="admin-user-card__icon-btn admin-user-card__icon-btn--ok" data-unblock="' +
              u.id +
              '" title="Разблокировать" aria-label="Разблокировать">' +
              ICO.unlock +
              "</button>"
            : '<button type="button" class="admin-user-card__icon-btn admin-user-card__icon-btn--danger" data-block="' +
              u.id +
              '" title="Блок" aria-label="Заблокировать">' +
              ICO.ban +
              "</button>";
          return (
            '<article class="admin-user-card" data-id="' +
            u.id +
            '" role="listitem">' +
            '<div class="admin-user-card__top">' +
            '<div class="admin-user-card__avatar" aria-hidden="true">' +
            esc(letter) +
            "</div>" +
            '<div class="admin-user-card__head">' +
            '<h3 class="admin-user-card__name">' +
            esc(u.name) +
            "</h3>" +
            '<span class="admin-user-card__account-id" title="ID аккаунта в системе">ID ' +
            esc(String(u.id)) +
            "</span>" +
            '<span class="admin-user-card__status ' +
            stClass +
            '">' +
            esc(stLabel) +
            "</span>" +
            "</div></div>" +
            '<p class="admin-user-card__role">' +
            esc(roleLabel) +
            "</p>" +
            '<p class="admin-user-card__line"><span class="admin-user-card__k">Тел.</span> ' +
            esc(formatRuPhone(u.phone)) +
            "</p>" +
            '<p class="admin-user-card__line"><span class="admin-user-card__k">Населенный пункт</span> ' +
            esc(String(u.locality || "Не указано")) +
            "</p>" +
            '<p class="admin-user-card__line"><span class="admin-user-card__k">Последний актив</span> ' +
            esc(lastActiveLabel) +
            "</p>" +
            '<div class="admin-user-card__actions">' +
            '<button type="button" class="admin-user-card__icon-btn" data-edit="' +
            u.id +
            '" title="Править" aria-label="Редактировать">' +
            ICO.edit +
            "</button>" +
            '<button type="button" class="admin-user-card__icon-btn admin-user-card__icon-btn--chat" data-chat="' +
            u.id +
            '" title="Чат" aria-label="Написать в чат поддержки">' +
            ICO.chat +
            "</button>" +
            '<button type="button" class="admin-user-card__icon-btn admin-user-card__icon-btn--danger" data-delete="' +
            u.id +
            '" title="Удалить аккаунт" aria-label="Удалить аккаунт пользователя">' +
            ICO.trash +
            "</button>" +
            roleBtn +
            blockBtn +
            "</div></article>"
          );
        })
        .join("") +
      "</div>" +
      sentinel +
      loadingMore;

    el.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-edit"));
        var u = usersCache.find(function (x) {
          return Number(x.id) === id;
        });
        if (u && typeof window.abAdminOpenUserEdit === "function") {
          window.abAdminOpenUserEdit(u);
        }
      });
    });
    el.querySelectorAll("[data-chat]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-chat"));
        if (!Number.isFinite(id)) return;
        if (typeof window.abAdminOpenSupportChat === "function") {
          window.abAdminOpenSupportChat(id);
        }
      });
    });
    el.querySelectorAll("[data-promote]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-promote"));
        patchUser(id, { role: "admin" });
      });
    });
    el.querySelectorAll("[data-demote]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Снять права администратора?")) return;
        var id = Number(btn.getAttribute("data-demote"));
        patchUser(id, { role: "user" });
      });
    });
    el.querySelectorAll("[data-block]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Заблокировать пользователя? Он не сможет пользоваться сайтом.")) return;
        var id = Number(btn.getAttribute("data-block"));
        patchUser(id, { blocked: true });
      });
    });
    el.querySelectorAll("[data-unblock]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-unblock"));
        patchUser(id, { blocked: false });
      });
    });
    el.querySelectorAll("[data-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-delete"));
        var u = usersCache.find(function (x) {
          return Number(x.id) === id;
        });
        if (!Number.isFinite(id) || id <= 0) return;
        var human = u && u.name ? '"' + String(u.name) + '"' : "этот аккаунт";
        if (!confirm("Удалить " + human + "? Действие необратимо.")) return;
        deleteUser(id);
      });
    });

    if (hasMore) setupInfiniteScroll();
  }

  async function patchUser(id, body) {
    try {
      await apiJson("/api/admin/users/" + id, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await fetchUsersPage(true);
    } catch (e) {
      alert(e.message || "Ошибка");
    }
  }

  async function deleteUser(id) {
    try {
      await apiJson("/api/admin/users/" + id, {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      await fetchUsersPage(true);
    } catch (e) {
      alert(e.message || "Ошибка");
    }
  }

  async function fetchUsersPage(reset) {
    if (!reset && listLoading) return;
    if (reset) {
      fetchGeneration += 1;
    }
    const myGen = fetchGeneration;
    listLoading = true;
    const offset = reset ? 0 : usersCache.length;
    const q = currentSearch.trim();
    const idRaw = currentIdSearch.trim();
    const useIdFilter = /^\d+$/.test(idRaw) && Number(idRaw) > 0;
    if (reset) {
      usersCache = [];
      renderUsers();
    }
    try {
      let url =
        "/api/admin/users/all?offset=" +
        String(offset) +
        "&limit=" +
        String(PAGE_SIZE);
      if (useIdFilter) url += "&id=" + encodeURIComponent(idRaw);
      else if (q) url += "&q=" + encodeURIComponent(q);
      const data = await apiJson(url, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (myGen !== fetchGeneration) return;
      const rows = data.users || [];
      usersTotal = Number(data.total) || 0;
      if (reset) {
        usersCache = rows.slice();
      } else {
        for (let i = 0; i < rows.length; i++) usersCache.push(rows[i]);
      }
      if (!reset && rows.length === 0 && usersCache.length < usersTotal) {
        usersTotal = usersCache.length;
      }
    } finally {
      if (myGen === fetchGeneration) {
        listLoading = false;
        updateUsersTotalHeading();
        renderUsers();
      }
    }
  }

  window.abInitUsers = function () {
    var el = document.getElementById("admin-users-list");
    if (!el || el.dataset.inited === "1") return;
    el.dataset.inited = "1";
    var search = document.getElementById("admin-users-search");
    var searchId = document.getElementById("admin-users-search-id");
    /** @type {ReturnType<typeof setTimeout> | null} */
    var searchDebounceTimer = null;
    function scheduleRefetch() {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function () {
        searchDebounceTimer = null;
        var next = search ? String(search.value || "").trim() : "";
        var nextId = searchId ? String(searchId.value || "").trim().replace(/\D/g, "") : "";
        if (searchId && String(searchId.value || "").replace(/\D/g, "") !== String(searchId.value || "")) {
          searchId.value = nextId;
        }
        if (next === currentSearch && nextId === currentIdSearch) return;
        currentSearch = next;
        currentIdSearch = nextId;
        fetchUsersPage(true).catch(function (e) {
          if (e.status === 403 || e.status === 401) {
            location.replace(e.status === 401 ? "/" : "/home");
            return;
          }
          alert(e.message || "Ошибка загрузки");
        });
      }, 320);
    }
    if (search) {
      search.addEventListener("input", scheduleRefetch);
    }
    if (searchId) {
      searchId.addEventListener("input", scheduleRefetch);
    }
    fetchUsersPage(true).catch(function (e) {
      if (e.status === 403 || e.status === 401) {
        location.replace(e.status === 401 ? "/" : "/home");
        return;
      }
      alert(e.message || "Ошибка загрузки");
    });
  };
})();
