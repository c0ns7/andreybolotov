(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";

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
    const res = await fetch(path, { ...opts, headers, cache: opts.cache !== undefined ? opts.cache : "default" });
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

  function pct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "0%";
    return v.toFixed(v % 1 ? 1 : 0) + "%";
  }

  function formatRuPhone(phone) {
    const d = String(phone || "").replace(/\D/g, "");
    if (d.length !== 11) return phone || "—";
    return "+7 (" + d.slice(1, 4) + ") " + d.slice(4, 7) + "-" + d.slice(7, 9) + "-" + d.slice(9, 11);
  }

  let currentStatsData = null;
  let currentStatsTab = "users";

  function buildChartRows() {
    const d = currentStatsData || {};
    if (currentStatsTab === "raffles") {
      const rows = Array.isArray(d.raffles) ? d.raffles : [];
      return rows.slice(0, 20).map(function (r) {
        return {
          label: String(r.title || "Акция"),
          value: Number(r.tickets_count || 0),
          suffix: "номерков",
        };
      });
    }
    if (currentStatsTab === "localities") {
      const rows = Array.isArray(d.localities) ? d.localities : [];
      return rows.slice(0, 25).map(function (loc) {
        return {
          label: String(loc.title || loc.key || "Населённый пункт"),
          value: Number(loc.users_count || 0),
          suffix: "чел.",
        };
      });
    }
    const rows = Array.isArray(d.top_users) ? d.top_users : [];
    return rows.slice(0, 25).map(function (u) {
      return {
        label: String(u.name || "Пользователь"),
        value: Number(u.tickets_confirmed || 0),
        suffix: "номерков",
      };
    });
  }

  function renderGraphModal() {
    const content = document.getElementById("admin-stats-graph-content");
    const title = document.getElementById("admin-stats-graph-title");
    if (!content || !title) return;
    const caption =
      currentStatsTab === "raffles"
        ? "График: номерки по акциям"
        : currentStatsTab === "localities"
          ? "График: пользователи по населённым пунктам"
          : "График: топ пользователей";
    title.textContent = caption;
    const rows = buildChartRows();
    if (!rows.length) {
      content.innerHTML = '<p class="admin-users-empty">Нет данных для графика.</p>';
      return;
    }
    const max = rows.reduce(function (acc, x) {
      return Math.max(acc, Number(x.value || 0));
    }, 0);
    const safeMax = max > 0 ? max : 1;
    content.innerHTML =
      '<div class="admin-stats-chart">' +
      rows
        .map(function (r) {
          const ratio = Math.max(0, Math.min(100, (Number(r.value || 0) / safeMax) * 100));
          return (
            '<div class="admin-stats-chart__row">' +
            '<div class="admin-stats-chart__label" title="' +
            esc(r.label) +
            '">' +
            esc(r.label) +
            "</div>" +
            '<div class="admin-stats-chart__bar-wrap"><div class="admin-stats-chart__bar" style="width:' +
            String(ratio.toFixed(2)) +
            '%"></div></div>' +
            '<div class="admin-stats-chart__value">' +
            esc(String(r.value || 0)) +
            " " +
            esc(String(r.suffix || "")) +
            "</div>" +
            "</div>"
          );
        })
        .join("") +
      "</div>";
  }

  function openGraphModal() {
    const modal = document.getElementById("modal-admin-stats-graph");
    if (!modal) return;
    renderGraphModal();
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeGraphModal() {
    const modal = document.getElementById("modal-admin-stats-graph");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function renderOverview(data) {
    const el = document.getElementById("admin-stats-overview");
    if (!el) return;
    const o = data && data.overview ? data.overview : {};
    el.innerHTML =
      '<div class="admin-stats-cards">' +
      '<article class="admin-stats-card"><p class="admin-stats-card__k">Пользователей</p><p class="admin-stats-card__v">' +
      esc(String(o.total_users || 0)) +
      "</p></article>" +
      '<article class="admin-stats-card"><p class="admin-stats-card__k">С населённым пунктом</p><p class="admin-stats-card__v">' +
      esc(String(o.users_with_locality || 0)) +
      "</p></article>" +
      '<article class="admin-stats-card"><p class="admin-stats-card__k">Без населённого пункта</p><p class="admin-stats-card__v">' +
      esc(String(o.users_without_locality || 0)) +
      " (" +
      esc(pct(o.users_without_locality_percent || 0)) +
      ")</p></article>" +
      "</div>";
  }

  function renderUsersPanel(data) {
    const el = document.getElementById("admin-stats-users-panel");
    if (!el) return;
    const rows = Array.isArray(data && data.top_users) ? data.top_users : [];
    if (!rows.length) {
      el.innerHTML = '<p class="admin-users-empty">Нет данных по подтверждённым номеркам.</p>';
      return;
    }
    el.innerHTML =
      '<div class="admin-stats-list">' +
      rows
        .map(function (u, i) {
          return (
            '<article class="admin-stats-item">' +
            '<p class="admin-stats-item__title">#' +
            esc(String(i + 1)) +
            " " +
            esc(u.name || "Пользователь") +
            "</p>" +
            '<p class="admin-stats-item__meta">' +
            esc(formatRuPhone(u.phone || "")) +
            " · " +
            esc(String(u.locality || "Населённый пункт не указан")) +
            "</p>" +
            '<p class="admin-stats-item__value">' +
            esc(String(u.tickets_confirmed || 0)) +
            " номерков</p>" +
            "</article>"
          );
        })
        .join("") +
      "</div>";
  }

  function renderRafflesPanel(data) {
    const el = document.getElementById("admin-stats-raffles-panel");
    if (!el) return;
    const rows = Array.isArray(data && data.raffles) ? data.raffles : [];
    if (!rows.length) {
      el.innerHTML = '<p class="admin-users-empty">Нет активной статистики по акциям.</p>';
      return;
    }
    el.innerHTML =
      '<div class="admin-stats-list">' +
      rows
        .map(function (r) {
          const top = Array.isArray(r.top_users) ? r.top_users : [];
          const topHtml = top.length
            ? '<ol class="admin-stats-sublist">' +
              top
                .map(function (u) {
                  return (
                    "<li>" +
                    esc(u.name || "Пользователь") +
                    " — " +
                    esc(String(u.tickets_count || 0)) +
                    "</li>"
                  );
                })
                .join("") +
              "</ol>"
            : '<p class="admin-stats-item__meta">Нет участников</p>';
          return (
            '<article class="admin-stats-item">' +
            '<p class="admin-stats-item__title">' +
            esc(r.title || "Акция") +
            "</p>" +
            '<p class="admin-stats-item__meta">Статус: ' +
            esc(r.status || "active") +
            " · Участников: " +
            esc(String(r.participants_count || 0)) +
            " · Номерков: " +
            esc(String(r.tickets_count || 0)) +
            "</p>" +
            topHtml +
            "</article>"
          );
        })
        .join("") +
      "</div>";
  }

  function renderLocalitiesPanel(data) {
    const el = document.getElementById("admin-stats-localities-panel");
    if (!el) return;
    const rows = Array.isArray(data && data.localities) ? data.localities : [];
    if (!rows.length) {
      el.innerHTML = '<p class="admin-users-empty">Нет данных по населённым пунктам.</p>';
      return;
    }
    el.innerHTML =
      '<div class="admin-stats-list">' +
      rows
        .map(function (loc) {
          const variants = Array.isArray(loc.variants) ? loc.variants : [];
          return (
            '<article class="admin-stats-item">' +
            '<p class="admin-stats-item__title">' +
            esc(loc.title || loc.key || "Населённый пункт") +
            "</p>" +
            '<p class="admin-stats-item__meta">Пользователей: ' +
            esc(String(loc.users_count || 0)) +
            " · Доля от всех: " +
            esc(pct(loc.share_percent || 0)) +
            "</p>" +
            (variants.length > 1
              ? '<p class="admin-stats-item__variants">Варианты: ' + esc(variants.join(", ")) + "</p>"
              : "") +
            "</article>"
          );
        })
        .join("") +
      "</div>";
  }

  function applyTab(tab) {
    const users = document.getElementById("admin-stats-users-panel");
    const raffles = document.getElementById("admin-stats-raffles-panel");
    const localities = document.getElementById("admin-stats-localities-panel");
    if (users) users.hidden = tab !== "users";
    if (raffles) raffles.hidden = tab !== "raffles";
    if (localities) localities.hidden = tab !== "localities";
    document.querySelectorAll(".admin-stats-tab").forEach(function (btn) {
      const on = btn.getAttribute("data-stats-tab") === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    currentStatsTab = tab;
  }

  async function loadStats() {
    const data = await apiJson("/api/admin/stats/users", {
      headers: authHeaders(),
      cache: "no-store",
    });
    currentStatsData = data;
    renderOverview(data);
    renderUsersPanel(data);
    renderRafflesPanel(data);
    renderLocalitiesPanel(data);
  }

  window.abInitStats = function () {
    const root = document.getElementById("admin-stats-app");
    if (!root || root.dataset.inited === "1") return;
    root.dataset.inited = "1";
    applyTab("users");
    var btnOpenGraph = document.getElementById("btn-admin-stats-graph");
    var btnCloseGraph = document.getElementById("btn-admin-stats-graph-close");
    var modalGraph = document.getElementById("modal-admin-stats-graph");
    if (btnOpenGraph) {
      btnOpenGraph.addEventListener("click", function () {
        openGraphModal();
      });
    }
    if (btnCloseGraph) {
      btnCloseGraph.addEventListener("click", function () {
        closeGraphModal();
      });
    }
    if (modalGraph) {
      modalGraph.addEventListener("click", function (e) {
        if (e.target === modalGraph) closeGraphModal();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (modalGraph && modalGraph.classList.contains("is-open")) closeGraphModal();
    });
    root.querySelectorAll(".admin-stats-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const tab = btn.getAttribute("data-stats-tab") || "users";
        applyTab(tab);
        if (modalGraph && modalGraph.classList.contains("is-open")) renderGraphModal();
      });
    });
    loadStats().catch(function (e) {
      if (e.status === 403 || e.status === 401) {
        location.replace(e.status === 401 ? "/" : "/home");
        return;
      }
      const users = document.getElementById("admin-stats-users-panel");
      if (users) users.innerHTML = '<p class="admin-users-empty">Не удалось загрузить статистику.</p>';
    });
  };
})();
