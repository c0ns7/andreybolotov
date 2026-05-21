(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (j && j.token) return j;
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

  function fetchSettings(toggle, statusEl, blogToggle, blogStatusEl) {
    if (!toggle) return;
    toggle.disabled = true;
    if (blogToggle) blogToggle.disabled = true;
    fetch("/api/admin/settings", { headers: authHeaders(), cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (x) {
        toggle.disabled = false;
        if (blogToggle) blogToggle.disabled = false;
        if (!x.ok) {
          if (statusEl) statusEl.textContent = x.d.error || "Не удалось загрузить настройки";
          return;
        }
        toggle.checked = !!x.d.maintenance_enabled;
        if (blogToggle) blogToggle.checked = !!x.d.blog_enabled;
        if (statusEl) statusEl.textContent = "";
        if (blogStatusEl) blogStatusEl.textContent = "";
      })
      .catch(function () {
        toggle.disabled = false;
        if (blogToggle) blogToggle.disabled = false;
        if (statusEl) statusEl.textContent = "Ошибка сети";
      });
  }

  function patchSettings(body, onOk, onErr) {
    fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (x) {
        if (!x.ok) {
          onErr(x.d);
          return;
        }
        onOk(x.d);
      })
      .catch(function () {
        onErr({ error: "Ошибка сети" });
      });
  }

  function bindMaxBroadcast() {
    const btn = document.getElementById("admin-settings-max-broadcast-btn");
    const statusEl = document.getElementById("admin-settings-max-broadcast-status");
    if (!btn) return;
    if (btn.dataset.abMaxBroadcastBound === "1") return;
    btn.dataset.abMaxBroadcastBound = "1";
    btn.addEventListener("click", function () {
      if (
        !window.confirm(
          "Отправить всем с закрепленной оплатой приглашение в приватный MAX? Повтор ограничен (не чаще одного раза в 2 минуты).",
        )
      ) {
        return;
      }
      btn.disabled = true;
      if (statusEl) statusEl.textContent = "Отправка...";
      fetch("/api/admin/broadcast-max-chat-invite", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, d: d };
          });
        })
        .then(function (x) {
          if (!x.ok) throw new Error((x.d && x.d.error) || "Ошибка");
          const sent = Number(x.d && x.d.sent) || 0;
          const total = Number(x.d && x.d.total) || 0;
          if (statusEl) statusEl.textContent = "Готово: " + String(sent) + " из " + String(total);
        })
        .catch(function (e) {
          if (statusEl) statusEl.textContent = String((e && e.message) || "Ошибка");
        })
        .finally(function () {
          btn.disabled = false;
        });
    });
  }

  window.abInitSettings = function () {
    const toggle = document.getElementById("admin-settings-maintenance");
    const statusEl = document.getElementById("admin-settings-status");
    const blogToggle = document.getElementById("admin-settings-blog-enabled");
    const blogStatusEl = document.getElementById("admin-settings-blog-status");
    if (!toggle) return;
    const s = loadSession();
    if (!s || !s.token) return;

    fetchSettings(toggle, statusEl, blogToggle, blogStatusEl);
    bindMaxBroadcast();

    if (toggle.dataset.abSettingsChangeBound !== "1") {
      toggle.dataset.abSettingsChangeBound = "1";
      toggle.addEventListener("change", function () {
        const on = toggle.checked;
        toggle.disabled = true;
        if (statusEl) statusEl.textContent = "Сохранение…";
        patchSettings(
          { maintenance_enabled: on },
          function (d) {
            toggle.disabled = false;
            toggle.checked = !!d.maintenance_enabled;
            if (blogToggle) blogToggle.checked = !!d.blog_enabled;
            if (statusEl) statusEl.textContent = "Сохранено";
            setTimeout(function () {
              if (statusEl && statusEl.textContent === "Сохранено") statusEl.textContent = "";
            }, 2000);
          },
          function (d) {
            toggle.disabled = false;
            toggle.checked = !on;
            if (statusEl) statusEl.textContent = d.error || "Не удалось сохранить";
          },
        );
      });
    }

    if (blogToggle && blogToggle.dataset.abSettingsChangeBound !== "1") {
      blogToggle.dataset.abSettingsChangeBound = "1";
      blogToggle.addEventListener("change", function () {
        const on = blogToggle.checked;
        blogToggle.disabled = true;
        if (blogStatusEl) blogStatusEl.textContent = "Сохранение…";
        patchSettings(
          { blog_enabled: on },
          function (d) {
            blogToggle.disabled = false;
            blogToggle.checked = !!d.blog_enabled;
            if (toggle) toggle.checked = !!d.maintenance_enabled;
            if (blogStatusEl) blogStatusEl.textContent = "Сохранено";
            setTimeout(function () {
              if (blogStatusEl && blogStatusEl.textContent === "Сохранено") blogStatusEl.textContent = "";
            }, 2000);
          },
          function (d) {
            blogToggle.disabled = false;
            blogToggle.checked = !on;
            if (blogStatusEl) blogStatusEl.textContent = d.error || "Не удалось сохранить";
          },
        );
      });
    }
  };
})();
