(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";
  const DEFAULT_SUPPORT_MAX_URL =
    "https://max.ru/u/f9LHodD0cOKSJihr4puAfiyfPGQJWImlRAdNuRhpYwI7qse5YaB625-1d3w";
  const DEFAULT_MAX_CHAT_JOIN_URL =
    "https://max.ru/join/_vIVZ3_FIwNimrGLFBwVEDWR408uZ3uynFc336CYX2k";

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

  function fetchSettings(toggle, statusEl, blogToggle, blogStatusEl, maxUrlInput, maxChatJoinInput) {
    if (!toggle) return;
    toggle.disabled = true;
    if (blogToggle) blogToggle.disabled = true;
    if (maxUrlInput) maxUrlInput.disabled = true;
    if (maxChatJoinInput) maxChatJoinInput.disabled = true;
    fetch("/api/admin/settings", { headers: authHeaders(), cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (x) {
        toggle.disabled = false;
        if (blogToggle) blogToggle.disabled = false;
        if (maxUrlInput) maxUrlInput.disabled = false;
        if (maxChatJoinInput) maxChatJoinInput.disabled = false;
        if (!x.ok) {
          if (statusEl) statusEl.textContent = x.d.error || "Не удалось загрузить настройки";
          return;
        }
        toggle.checked = !!x.d.maintenance_enabled;
        if (blogToggle) blogToggle.checked = !!x.d.blog_enabled;
        if (maxUrlInput) {
          maxUrlInput.value = String(x.d.support_max_url || DEFAULT_SUPPORT_MAX_URL);
        }
        if (maxChatJoinInput) {
          maxChatJoinInput.value = String(x.d.max_chat_join_url || DEFAULT_MAX_CHAT_JOIN_URL);
        }
        if (statusEl) statusEl.textContent = "";
        if (blogStatusEl) blogStatusEl.textContent = "";
      })
      .catch(function () {
        toggle.disabled = false;
        if (blogToggle) blogToggle.disabled = false;
        if (maxUrlInput) maxUrlInput.disabled = false;
        if (maxChatJoinInput) maxChatJoinInput.disabled = false;
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

  function bindSupportMaxUrl(maxUrlInput, saveBtn, statusEl) {
    if (!maxUrlInput || !saveBtn) return;
    if (saveBtn.dataset.abSupportMaxBound === "1") return;
    saveBtn.dataset.abSupportMaxBound = "1";
    saveBtn.addEventListener("click", function () {
      const url = String(maxUrlInput.value || "").trim();
      if (!url) {
        if (statusEl) statusEl.textContent = "Укажите ссылку";
        return;
      }
      saveBtn.disabled = true;
      maxUrlInput.disabled = true;
      if (statusEl) statusEl.textContent = "Сохранение…";
      patchSettings(
        { support_max_url: url },
        function (d) {
          saveBtn.disabled = false;
          maxUrlInput.disabled = false;
          maxUrlInput.value = String(d.support_max_url || url);
          if (statusEl) statusEl.textContent = "Сохранено";
          setTimeout(function () {
            if (statusEl && statusEl.textContent === "Сохранено") statusEl.textContent = "";
          }, 2000);
        },
        function (d) {
          saveBtn.disabled = false;
          maxUrlInput.disabled = false;
          if (statusEl) statusEl.textContent = d.error || "Не удалось сохранить";
        },
      );
    });
  }

  function bindMaxChatJoinUrl(maxChatJoinInput, saveBtn, statusEl) {
    if (!maxChatJoinInput || !saveBtn) return;
    if (saveBtn.dataset.abMaxChatJoinBound === "1") return;
    saveBtn.dataset.abMaxChatJoinBound = "1";
    saveBtn.addEventListener("click", function () {
      const url = String(maxChatJoinInput.value || "").trim();
      if (!url) {
        if (statusEl) statusEl.textContent = "Укажите ссылку";
        return;
      }
      saveBtn.disabled = true;
      maxChatJoinInput.disabled = true;
      if (statusEl) statusEl.textContent = "Сохранение…";
      patchSettings(
        { max_chat_join_url: url },
        function (d) {
          saveBtn.disabled = false;
          maxChatJoinInput.disabled = false;
          maxChatJoinInput.value = String(d.max_chat_join_url || url);
          if (statusEl) statusEl.textContent = "Сохранено";
          setTimeout(function () {
            if (statusEl && statusEl.textContent === "Сохранено") statusEl.textContent = "";
          }, 2000);
        },
        function (d) {
          saveBtn.disabled = false;
          maxChatJoinInput.disabled = false;
          if (statusEl) statusEl.textContent = d.error || "Не удалось сохранить";
        },
      );
    });
  }

  window.abInitSettings = function () {
    const toggle = document.getElementById("admin-settings-maintenance");
    const statusEl = document.getElementById("admin-settings-status");
    const blogToggle = document.getElementById("admin-settings-blog-enabled");
    const blogStatusEl = document.getElementById("admin-settings-blog-status");
    const maxUrlInput = document.getElementById("admin-settings-support-max-url");
    const maxSaveBtn = document.getElementById("admin-settings-support-max-save");
    const maxStatusEl = document.getElementById("admin-settings-support-max-status");
    const maxChatJoinInput = document.getElementById("admin-settings-max-chat-join-url");
    const maxChatJoinSaveBtn = document.getElementById("admin-settings-max-chat-join-save");
    const maxChatJoinStatusEl = document.getElementById("admin-settings-max-chat-join-status");
    if (!toggle) return;
    const s = loadSession();
    if (!s || !s.token) return;

    fetchSettings(toggle, statusEl, blogToggle, blogStatusEl, maxUrlInput, maxChatJoinInput);
    bindMaxBroadcast();
    bindSupportMaxUrl(maxUrlInput, maxSaveBtn, maxStatusEl);
    bindMaxChatJoinUrl(maxChatJoinInput, maxChatJoinSaveBtn, maxChatJoinStatusEl);

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
