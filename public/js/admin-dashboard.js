(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";

  const QUICK_LINKS = [
    { area: "support", tab: "support", label: "Поддержка", hint: "Диалоги и чаты", href: "/admin?tab=support" },
    { area: "payments", tab: "payments", label: "Оплаты", hint: "Проверка чеков", href: "/admin?tab=payments" },
    { area: "raffles", tab: "raffles", label: "Акции", hint: "Каталог акций", href: "/admin?tab=raffles" },
    { area: "prizes", tab: "prizes", label: "Призы", hint: "Выдача призов", href: "/admin?tab=prizes" },
    { area: "users", tab: "users", label: "Пользователи", hint: "Список аккаунтов", href: "/admin?tab=users" },
    { area: "stats", tab: "stats", label: "Статистика", hint: "Подробная аналитика", href: "/admin?tab=stats" },
    { area: "settings", tab: "settings", label: "Настройки", hint: "Сайт и техработы", href: "/admin?tab=settings" },
    { area: "music", tab: "music", label: "Музыка", hint: "Плейлист", href: "/admin?tab=music" },
  ];

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

  function staffAreas() {
    return Array.isArray(window.abAdminStaffAreas) ? window.abAdminStaffAreas : [];
  }

  function canArea(area) {
    return staffAreas().indexOf(area) >= 0;
  }

  function formatUpdated(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "";
    try {
      return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(n));
    } catch {
      return "";
    }
  }

  function metricCard(key, label, value, hint, href, area) {
    if (area && !canArea(area)) return "";
    const inner =
      href && canArea(area)
        ? '<a class="admin-home-metric admin-home-metric--link" href="' + esc(href) + '">'
        : '<article class="admin-home-metric">';
    const outro = href && canArea(area) ? "</a>" : "</article>";
    return (
      inner +
      '<p class="admin-home-metric__k">' +
      esc(label) +
      "</p>" +
      '<p class="admin-home-metric__v" data-metric="' +
      esc(key) +
      '">' +
      esc(String(value)) +
      "</p>" +
      (hint ? '<p class="admin-home-metric__hint">' + esc(hint) + "</p>" : "") +
      outro
    );
  }

  function renderMetrics(data) {
    const el = document.getElementById("admin-home-metrics");
    if (!el) return;
    const m = data && data.metrics ? data.metrics : {};
    const cards = [];

    if (canArea("users") || canArea("stats")) {
      cards.push(metricCard("total_users", "Пользователей", m.total_users || 0, "Всего регистраций", "/admin?tab=users", "users"));
    }

    if (canArea("raffles")) {
      cards.push(
        metricCard(
          "active_raffles",
          "Активных акций",
          m.active_raffles || 0,
          "Всего акций: " + String(m.total_raffles || 0),
          "/admin?tab=raffles",
          "raffles",
        ),
      );
    }

    if (canArea("payments")) {
      cards.push(
        metricCard(
          "pending_payments",
          "Оплат на проверке",
          m.pending_payments || 0,
          "Чеки ждут модерации",
          "/admin?tab=payments",
          "payments",
        ),
      );
    }

    if (canArea("prizes")) {
      cards.push(
        metricCard(
          "prizes_need_attention",
          "Призов в работе",
          m.prizes_need_attention || 0,
          "Ожидают, ответ или выполнение",
          "/admin?tab=prizes",
          "prizes",
        ),
      );
    }

    if (canArea("support")) {
      cards.push(
        metricCard(
          "unread_threads",
          "Диалогов с новым",
          m.unread_support_threads || 0,
          "Непрочитанных сообщений: " + String(m.unread_support_messages || 0),
          "/admin?tab=support",
          "support",
        ),
      );
    }

    if (!cards.length) {
      el.innerHTML =
        '<p class="admin-home-empty">Нет доступных показателей для вашей роли. Выберите раздел в меню слева.</p>';
      return;
    }

    el.innerHTML = '<div class="admin-home-metrics__grid">' + cards.join("") + "</div>";
  }

  function renderSite(data) {
    const el = document.getElementById("admin-home-site");
    if (!el) return;
    if (!canArea("settings")) {
      el.hidden = true;
      return;
    }
    const site = data && data.site ? data.site : {};
    const chips = [];
    chips.push(
      '<span class="admin-home-chip' +
        (site.maintenance_enabled ? " admin-home-chip--warn" : "") +
        '">Техработы: ' +
        (site.maintenance_enabled ? "включены" : "выключены") +
        "</span>",
    );
    chips.push(
      '<span class="admin-home-chip">Блог: ' + (site.blog_enabled ? "открыт" : "закрыт") + "</span>",
    );
    chips.push(
      '<span class="admin-home-chip">Музыка: ' + (site.music_enabled ? "включена" : "выключена") + "</span>",
    );
    el.innerHTML =
      '<section class="admin-home-site__inner" aria-label="Состояние сайта">' +
      '<h3 class="admin-home-site__title">Состояние сайта</h3>' +
      '<div class="admin-home-site__chips">' +
      chips.join("") +
      "</div>" +
      "</section>";
    el.hidden = false;
  }

  function renderQuickLinks() {
    const el = document.getElementById("admin-home-quick");
    if (!el) return;
    const links = QUICK_LINKS.filter(function (item) {
      return canArea(item.area);
    }).filter(function (item) {
      return item.tab !== "home";
    });
    if (!links.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML =
      '<h3 class="admin-home-quick__title">Разделы</h3>' +
      '<div class="admin-home-quick__grid">' +
      links
        .map(function (item) {
          return (
            '<a class="admin-home-quick__link" href="' +
            esc(item.href) +
            '">' +
            '<span class="admin-home-quick__label">' +
            esc(item.label) +
            "</span>" +
            '<span class="admin-home-quick__hint">' +
            esc(item.hint) +
            "</span>" +
            "</a>"
          );
        })
        .join("") +
      "</div>";
  }

  async function loadDashboard() {
    const status = document.getElementById("admin-home-status");
    if (status) {
      status.hidden = false;
      status.textContent = "Обновление сводки…";
    }
    try {
      const data = await apiJson("/api/admin/dashboard", {
        headers: authHeaders(),
        cache: "no-store",
      });
      renderMetrics(data);
      renderSite(data);
      renderQuickLinks();
      if (status) {
        const stamp = formatUpdated(data.generated_at);
        status.textContent = stamp ? "Обновлено " + stamp : "Сводка обновлена";
      }
    } catch (e) {
      if (status) status.textContent = e.message || "Не удалось загрузить сводку";
    }
  }

  window.abInitHome = function () {
    const root = document.getElementById("admin-home-app");
    if (!root || root.dataset.inited === "1") return;
    root.dataset.inited = "1";
    renderQuickLinks();
    loadDashboard();
  };

  window.abReloadAdminHome = function () {
    const root = document.getElementById("admin-home-app");
    if (!root) return;
    loadDashboard();
  };
})();
