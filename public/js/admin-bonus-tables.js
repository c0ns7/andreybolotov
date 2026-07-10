(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";
  let currentRaffleId = null;
  let currentRaffleTitle = "";
  let tablesCache = [];
  let editingTableId = null;

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
    const headers = { ...(opts.headers || {}), ...authHeaders() };
    if (opts.body != null && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const res = await fetch(path, { ...opts, headers, cache: "no-store" });
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

  const BTN_ICO = {
    view:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
    edit:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
    trash:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
    link:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    refresh:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
    plus:
      '<svg class="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>',
    manual:
      '<svg class="admin-bonus-table-card__manual-ico" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>',
  };

  function cardStatusClass(status) {
    const s = String(status || "active");
    if (s === "draft") return "admin-bonus-table-card--draft";
    if (s === "ended") return "admin-bonus-table-card--ended";
    return "admin-bonus-table-card--active";
  }

  function $(id) {
    return document.getElementById(id);
  }

  function formatDateTimeLocalFromMs(ms) {
    if (typeof window.formatSiteDateTimeLocalFromUtcMs === "function") {
      return window.formatSiteDateTimeLocalFromUtcMs(ms);
    }
    const d = new Date(Number(ms));
    if (!Number.isFinite(d.getTime())) return "";
    const pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function defaultEndLocal() {
    const now = Date.now();
    const start = formatDateTimeLocalFromMs(now);
    const end = formatDateTimeLocalFromMs(now + 24 * 60 * 60 * 1000);
    return { start: start, end: end };
  }

  function openModal() {
    const modal = $("modal-bonus-tables");
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    const modal = $("modal-bonus-tables");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    hideForm();
  }

  function hideForm() {
    editingTableId = null;
    const formWrap = $("bonus-tables-form-wrap");
    if (formWrap) formWrap.hidden = true;
    const form = $("form-bonus-table");
    if (form) form.reset();
  }

  function showForm(table) {
    const formWrap = $("bonus-tables-form-wrap");
    if (!formWrap) return;
    formWrap.hidden = false;
    const titleEl = $("bonus-table-form-title");
    if (titleEl) titleEl.textContent = table ? "Редактировать таблицу" : "Новая бонусная таблица";
    const defaults = defaultEndLocal();
    $("bonus-table-title").value = table ? String(table.title || "") : "";
    $("bonus-table-description").value = table ? String(table.description || "") : "";
    $("bonus-table-access-mode").value = table ? String(table.access_mode || "closed") : "closed";
    $("bonus-table-view-privacy").value = table ? String(table.view_privacy || "participants_admins") : "participants_admins";
    $("bonus-table-start").value = table ? String(table.start_at_local || defaults.start) : defaults.start;
    $("bonus-table-end").value = table ? String(table.end_at_local || defaults.end) : defaults.end;
    $("bonus-table-count-from").value = table ? String(table.count_from || "table_created") : "table_created";
    $("bonus-table-tickets-required").value = table ? String(table.tickets_required || 2) : "2";
    $("bonus-table-bonus-slots").value = table ? String(table.bonus_slots_per_reward || 1) : "1";
    $("bonus-table-aggregation").value = table ? String(table.aggregation || "cumulative") : "cumulative";
    $("bonus-table-period-scope").value = table ? String(table.period_scope || "same_day") : "same_day";
    $("bonus-table-status").value = table ? String(table.status || "active") : "active";
    editingTableId = table ? Number(table.id) : null;
    updatePublicLinkUi(table || null);
  }

  function updatePublicLinkUi(table) {
    const wrap = $("bonus-table-public-link-wrap");
    const input = $("bonus-table-public-link");
    if (!wrap || !input) return;
    if (table && table.access_mode === "link" && table.public_url) {
      wrap.hidden = false;
      input.value = table.public_url;
    } else {
      wrap.hidden = true;
      input.value = "";
    }
  }

  function statusBadge(status) {
    const s = String(status || "active");
    if (s === "draft") return '<span class="admin-bonus-table-badge admin-bonus-table-badge--draft">Черновик</span>';
    if (s === "ended") return '<span class="admin-bonus-table-badge admin-bonus-table-badge--ended">Завершена</span>';
    return '<span class="admin-bonus-table-badge admin-bonus-table-badge--active">Активна</span>';
  }

  function renderList() {
    const list = $("bonus-tables-list");
    if (!list) return;
    if (!tablesCache.length) {
      list.innerHTML = '<p class="admin-bonus-tables-empty">Пока нет бонусных таблиц для этой акции.</p>';
      return;
    }
    list.innerHTML = tablesCache
      .map(function (t) {
        const linkBtn =
          t.access_mode === "link" && t.public_url
            ? '<button type="button" class="admin-raffle-btn admin-raffle-btn--participants admin-bonus-table-card__link" data-copy-url="' +
              esc(t.public_url) +
              '">' +
              BTN_ICO.link +
              "Скопировать ссылку</button>"
            : "";
        const backfillBtn =
          t.count_from === "include_prior_same_day"
            ? '<button type="button" class="admin-raffle-btn admin-raffle-btn--stats admin-bonus-table-card__backfill" data-id="' +
              esc(String(t.id)) +
              '">' +
              BTN_ICO.refresh +
              "Пересчитать за день</button>"
            : "";
        return (
          '<article class="admin-bonus-table-card ' +
          cardStatusClass(t.status) +
          '" data-id="' +
          esc(String(t.id)) +
          '">' +
          '<div class="admin-bonus-table-card__head">' +
          "<h3>" +
          esc(t.title) +
          "</h3>" +
          statusBadge(t.status) +
          "</div>" +
          (t.condition_label
            ? '<p class="admin-bonus-table-card__condition">' + esc(t.condition_label || "") + "</p>"
            : "") +
          '<p class="admin-bonus-table-card__stats"><span class="admin-bonus-table-card__stats-label">Записей</span> <strong>' +
          esc(String(t.entry_count || 0)) +
          "</strong> · " +
          esc(String(t.start_at_local || "").replace("T", " ")) +
          " — " +
          esc(String(t.end_at_local || "").replace("T", " ")) +
          " (Агинское)</p>" +
          '<div class="admin-bonus-table-card__actions">' +
          '<button type="button" class="admin-raffle-btn admin-raffle-btn--primary admin-bonus-table-card__view" data-slug="' +
          esc(String(t.public_slug || "")) +
          '">' +
          BTN_ICO.view +
          "Открыть</button>" +
          '<button type="button" class="admin-raffle-btn admin-bonus-table-card__edit" data-id="' +
          esc(String(t.id)) +
          '">' +
          BTN_ICO.edit +
          "Изменить</button>" +
          '<button type="button" class="admin-raffle-btn admin-raffle-btn--danger admin-bonus-table-card__delete" data-id="' +
          esc(String(t.id)) +
          '">' +
          BTN_ICO.trash +
          "Удалить</button>" +
          linkBtn +
          backfillBtn +
          "</div>" +
          '<div class="admin-bonus-table-card__manual">' +
          '<div class="admin-bonus-table-card__manual-head">' +
          BTN_ICO.manual +
          '<span class="admin-bonus-table-card__manual-label">Добавить вручную</span>' +
          "</div>" +
          '<div class="admin-bonus-table-card__manual-row">' +
          '<input type="tel" class="input admin-bonus-table-card__phone" inputmode="numeric" placeholder="+7 (___) ___-__-__" data-table-id="' +
          esc(String(t.id)) +
          '" aria-label="Телефон пользователя" />' +
          '<input type="number" class="input admin-bonus-table-card__slots" min="1" max="20" value="1" title="Сколько мест добавить" aria-label="Количество мест" data-table-id="' +
          esc(String(t.id)) +
          '" />' +
          '<label class="admin-bonus-table-card__notify">' +
          '<input type="checkbox" class="admin-bonus-table-card__notify-check" data-table-id="' +
          esc(String(t.id)) +
          '" checked />' +
          " Чат" +
          "</label>" +
          '<button type="button" class="admin-raffle-btn admin-raffle-btn--primary admin-bonus-table-card__add" data-id="' +
          esc(String(t.id)) +
          '">' +
          BTN_ICO.plus +
          "Добавить</button>" +
          "</div></div></article>"
        );
      })
      .join("");
  }

  async function loadTables() {
    if (!currentRaffleId) return;
    const data = await apiJson("/api/admin/raffles/" + encodeURIComponent(String(currentRaffleId)) + "/bonus-tables");
    tablesCache = Array.isArray(data.tables) ? data.tables : [];
    renderList();
  }

  async function saveForm(ev) {
    ev.preventDefault();
    if (!currentRaffleId) return;
    const payload = {
      title: String($("bonus-table-title").value || "").trim(),
      description: String($("bonus-table-description").value || "").trim(),
      access_mode: String($("bonus-table-access-mode").value || "closed"),
      view_privacy: String($("bonus-table-view-privacy").value || "participants_admins"),
      start_at_local: String($("bonus-table-start").value || ""),
      end_at_local: String($("bonus-table-end").value || ""),
      count_from: String($("bonus-table-count-from").value || "table_created"),
      tickets_required: Number($("bonus-table-tickets-required").value || 2),
      bonus_slots_per_reward: Number($("bonus-table-bonus-slots").value || 1),
      aggregation: String($("bonus-table-aggregation").value || "cumulative"),
      period_scope: String($("bonus-table-period-scope").value || "same_day"),
      status: String($("bonus-table-status").value || "active"),
    };
    try {
      if (editingTableId) {
        await apiJson("/api/admin/bonus-tables/" + encodeURIComponent(String(editingTableId)), {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiJson("/api/admin/raffles/" + encodeURIComponent(String(currentRaffleId)) + "/bonus-tables", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      hideForm();
      await loadTables();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  function bindEvents() {
    const closeBtn = $("modal-bonus-tables-close");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    const modal = $("modal-bonus-tables");
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeModal();
      });
    }
    const newBtn = $("btn-bonus-table-new");
    if (newBtn) newBtn.addEventListener("click", function () {
      showForm(null);
    });
    const cancelBtn = $("btn-bonus-table-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", hideForm);
    const form = $("form-bonus-table");
    if (form) form.addEventListener("submit", saveForm);
    const accessMode = $("bonus-table-access-mode");
    if (accessMode) {
      accessMode.addEventListener("change", function () {
        if (editingTableId) {
          const t = tablesCache.find(function (x) {
            return Number(x.id) === editingTableId;
          });
          if (t) {
            t.access_mode = accessMode.value;
            if (accessMode.value === "link" && t.public_slug) {
              t.public_url = window.location.origin + "/home/bonus-table/" + encodeURIComponent(t.public_slug);
            }
          }
        }
        updatePublicLinkUi(
          editingTableId
            ? tablesCache.find(function (x) {
                return Number(x.id) === editingTableId;
              }) || null
            : null,
        );
      });
    }
    const copyBtn = $("btn-bonus-table-copy-link");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        const input = $("bonus-table-public-link");
        if (!input || !input.value) return;
        navigator.clipboard.writeText(input.value).then(
          function () {
            copyBtn.textContent = "Скопировано!";
            setTimeout(function () {
              copyBtn.textContent = "Копировать";
            }, 1500);
          },
          function () {
            input.select();
            document.execCommand("copy");
          },
        );
      });
    }
    const list = $("bonus-tables-list");
    if (list) {
      list.addEventListener("click", async function (e) {
        const t = e.target;
        if (!t || !t.closest) return;
        const editBtn = t.closest(".admin-bonus-table-card__edit");
        if (editBtn) {
          const id = Number(editBtn.getAttribute("data-id"));
          const row = tablesCache.find(function (x) {
            return Number(x.id) === id;
          });
          if (row) showForm(row);
          return;
        }
        const delBtn = t.closest(".admin-bonus-table-card__delete");
        if (delBtn) {
          const id = Number(delBtn.getAttribute("data-id"));
          if (!Number.isFinite(id)) return;
          if (!confirm("Удалить бонусную таблицу?")) return;
          try {
            await apiJson("/api/admin/bonus-tables/" + encodeURIComponent(String(id)), { method: "DELETE" });
            await loadTables();
          } catch (err) {
            alert(err instanceof Error ? err.message : String(err));
          }
          return;
        }
        const viewBtn = t.closest(".admin-bonus-table-card__view");
        if (viewBtn) {
          const slug = String(viewBtn.getAttribute("data-slug") || "").trim();
          if (slug) window.open("/home/bonus-table/" + encodeURIComponent(slug), "_blank");
          return;
        }
        const copyUrlBtn = t.closest(".admin-bonus-table-card__link");
        if (copyUrlBtn) {
          const url = String(copyUrlBtn.getAttribute("data-copy-url") || "");
          if (url) {
            navigator.clipboard.writeText(url).catch(function () {});
            copyUrlBtn.textContent = "Скопировано!";
            setTimeout(function () {
              copyUrlBtn.textContent = "Скопировать ссылку";
            }, 1500);
          }
          return;
        }
        const backfillBtn = t.closest(".admin-bonus-table-card__backfill");
        if (backfillBtn) {
          const id = Number(backfillBtn.getAttribute("data-id"));
          if (!Number.isFinite(id)) return;
          try {
            backfillBtn.disabled = true;
            await apiJson("/api/admin/bonus-tables/" + encodeURIComponent(String(id)) + "/backfill", { method: "POST" });
            await loadTables();
          } catch (err) {
            alert(err instanceof Error ? err.message : String(err));
          } finally {
            backfillBtn.disabled = false;
          }
          return;
        }
        const addBtn = t.closest(".admin-bonus-table-card__add");
        if (addBtn) {
          const id = Number(addBtn.getAttribute("data-id"));
          if (!Number.isFinite(id)) return;
          const card = addBtn.closest(".admin-bonus-table-card");
          if (!card) return;
          const phoneInput = card.querySelector(".admin-bonus-table-card__phone");
          const slotsInput = card.querySelector(".admin-bonus-table-card__slots");
          const notifyInput = card.querySelector(".admin-bonus-table-card__notify-check");
          const phone = phoneInput ? String(phoneInput.value || "").trim() : "";
          const slots = slotsInput ? Number(slotsInput.value || 1) : 1;
          const sendChat = notifyInput ? !!notifyInput.checked : true;
          if (!phone) {
            alert("Введите телефон пользователя");
            return;
          }
          try {
            addBtn.disabled = true;
            const data = await apiJson("/api/admin/bonus-tables/" + encodeURIComponent(String(id)) + "/entries", {
              method: "POST",
              body: JSON.stringify({ phone: phone, slots: slots, send_chat: sendChat }),
            });
            if (phoneInput) phoneInput.value = "";
            if (slotsInput) slotsInput.value = "1";
            const pos = Array.isArray(data.positions) ? data.positions.map(function (p) { return "#" + p; }).join(", ") : "";
            alert("Добавлено" + (pos ? ": " + pos : ""));
            await loadTables();
          } catch (err) {
            alert(err instanceof Error ? err.message : String(err));
          } finally {
            addBtn.disabled = false;
          }
        }
      });
    }
  }

  function open(raffleId, raffleTitle) {
    currentRaffleId = Number(raffleId);
    currentRaffleTitle = String(raffleTitle || "Акция");
    const subtitle = $("modal-bonus-tables-subtitle");
    if (subtitle) subtitle.textContent = currentRaffleTitle;
    hideForm();
    openModal();
    loadTables().catch(function (e) {
      alert(e instanceof Error ? e.message : String(e));
    });
  }

  bindEvents();
  window.AbAdminBonusTables = { open: open };
})();
