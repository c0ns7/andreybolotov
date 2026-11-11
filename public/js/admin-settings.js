(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";
  const DEFAULT_SUPPORT_MAX_URL =
    "https://max.ru/u/f9LHodD0cOKSJihr4puAfiyfPGQJWImlRAdNuRhpYwI7qse5YaB625-1d3w";
  const DEFAULT_MAX_CHAT_JOIN_URL =
    "https://max.ru/join/_vIVZ3_FIwNimrGLFBwVEDWR408uZ3uynFc336CYX2k";
  const DEFAULT_RAFFLE_RESERVE_MINUTES = 15;
  const DEFAULT_RAFFLE_REJECT_REOPEN_MINUTES = 1440;

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

  function setDisabled(els, on) {
    for (var i = 0; i < els.length; i++) {
      if (els[i]) els[i].disabled = !!on;
    }
  }

  function applySettingsToForm(d, refs) {
    if (refs.toggle) refs.toggle.checked = !!d.maintenance_enabled;
    if (refs.blogToggle) refs.blogToggle.checked = !!d.blog_enabled;
    if (refs.maxUrlInput) {
      refs.maxUrlInput.value = String(d.support_max_url || DEFAULT_SUPPORT_MAX_URL);
    }
    if (refs.maxChatJoinInput) {
      refs.maxChatJoinInput.value = String(d.max_chat_join_url || DEFAULT_MAX_CHAT_JOIN_URL);
    }
    if (refs.reserveInput) {
      refs.reserveInput.value = String(
        Number(d.raffle_reserve_minutes) > 0
          ? Math.floor(Number(d.raffle_reserve_minutes))
          : DEFAULT_RAFFLE_RESERVE_MINUTES,
      );
    }
    if (refs.rejectInput) {
      refs.rejectInput.value = String(
        Number(d.raffle_reject_reopen_minutes) > 0
          ? Math.floor(Number(d.raffle_reject_reopen_minutes))
          : DEFAULT_RAFFLE_REJECT_REOPEN_MINUTES,
      );
    }
  }

  function fetchSettings(refs) {
    if (!refs.toggle) return;
    setDisabled(
      [
        refs.toggle,
        refs.blogToggle,
        refs.maxUrlInput,
        refs.maxChatJoinInput,
        refs.reserveInput,
        refs.rejectInput,
        refs.timersSaveBtn,
      ],
      true,
    );
    fetch("/api/admin/settings", { headers: authHeaders(), cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (x) {
        setDisabled(
          [
            refs.toggle,
            refs.blogToggle,
            refs.maxUrlInput,
            refs.maxChatJoinInput,
            refs.reserveInput,
            refs.rejectInput,
            refs.timersSaveBtn,
          ],
          false,
        );
        if (!x.ok) {
          if (refs.statusEl) refs.statusEl.textContent = x.d.error || "Не удалось загрузить настройки";
          return;
        }
        applySettingsToForm(x.d, refs);
        if (refs.statusEl) refs.statusEl.textContent = "";
        if (refs.blogStatusEl) refs.blogStatusEl.textContent = "";
        if (refs.timersStatusEl) refs.timersStatusEl.textContent = "";
      })
      .catch(function () {
        setDisabled(
          [
            refs.toggle,
            refs.blogToggle,
            refs.maxUrlInput,
            refs.maxChatJoinInput,
            refs.reserveInput,
            refs.rejectInput,
            refs.timersSaveBtn,
          ],
          false,
        );
        if (refs.statusEl) refs.statusEl.textContent = "Ошибка сети";
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

  function bindRaffleTimers(reserveInput, rejectInput, saveBtn, statusEl) {
    if (!reserveInput || !rejectInput || !saveBtn) return;
    if (saveBtn.dataset.abRaffleTimersBound === "1") return;
    saveBtn.dataset.abRaffleTimersBound = "1";
    saveBtn.addEventListener("click", function () {
      const reserveMins = Math.floor(Number(reserveInput.value));
      const rejectMins = Math.floor(Number(rejectInput.value));
      if (!Number.isFinite(reserveMins) || reserveMins < 1 || reserveMins > 180) {
        if (statusEl) statusEl.textContent = "Бронь: укажите от 1 до 180 минут";
        return;
      }
      if (!Number.isFinite(rejectMins) || rejectMins < 15 || rejectMins > 10080) {
        if (statusEl) statusEl.textContent = "После отклонения: укажите от 15 до 10080 минут";
        return;
      }
      saveBtn.disabled = true;
      reserveInput.disabled = true;
      rejectInput.disabled = true;
      if (statusEl) statusEl.textContent = "Сохранение…";
      patchSettings(
        {
          raffle_reserve_minutes: reserveMins,
          raffle_reject_reopen_minutes: rejectMins,
        },
        function (d) {
          saveBtn.disabled = false;
          reserveInput.disabled = false;
          rejectInput.disabled = false;
          reserveInput.value = String(
            Number(d.raffle_reserve_minutes) > 0
              ? Math.floor(Number(d.raffle_reserve_minutes))
              : reserveMins,
          );
          rejectInput.value = String(
            Number(d.raffle_reject_reopen_minutes) > 0
              ? Math.floor(Number(d.raffle_reject_reopen_minutes))
              : rejectMins,
          );
          if (statusEl) statusEl.textContent = "Сохранено";
          setTimeout(function () {
            if (statusEl && statusEl.textContent === "Сохранено") statusEl.textContent = "";
          }, 2000);
        },
        function (d) {
          saveBtn.disabled = false;
          reserveInput.disabled = false;
          rejectInput.disabled = false;
          if (statusEl) statusEl.textContent = d.error || "Не удалось сохранить";
        },
      );
    });
  }

  window.abInitSettings = function () {
    const refs = {
      toggle: document.getElementById("admin-settings-maintenance"),
      statusEl: document.getElementById("admin-settings-status"),
      blogToggle: document.getElementById("admin-settings-blog-enabled"),
      blogStatusEl: document.getElementById("admin-settings-blog-status"),
      maxUrlInput: document.getElementById("admin-settings-support-max-url"),
      maxChatJoinInput: document.getElementById("admin-settings-max-chat-join-url"),
      reserveInput: document.getElementById("admin-settings-raffle-reserve-minutes"),
      rejectInput: document.getElementById("admin-settings-raffle-reject-reopen-minutes"),
      timersSaveBtn: document.getElementById("admin-settings-raffle-timers-save"),
      timersStatusEl: document.getElementById("admin-settings-raffle-timers-status"),
    };
    const maxSaveBtn = document.getElementById("admin-settings-support-max-save");
    const maxStatusEl = document.getElementById("admin-settings-support-max-status");
    const maxChatJoinSaveBtn = document.getElementById("admin-settings-max-chat-join-save");
    const maxChatJoinStatusEl = document.getElementById("admin-settings-max-chat-join-status");
    if (!refs.toggle) return;
    const s = loadSession();
    if (!s || !s.token) return;

    fetchSettings(refs);
    bindMaxBroadcast();
    bindSupportMaxUrl(refs.maxUrlInput, maxSaveBtn, maxStatusEl);
    bindMaxChatJoinUrl(refs.maxChatJoinInput, maxChatJoinSaveBtn, maxChatJoinStatusEl);
    bindRaffleTimers(refs.reserveInput, refs.rejectInput, refs.timersSaveBtn, refs.timersStatusEl);

    if (refs.toggle.dataset.abSettingsChangeBound !== "1") {
      refs.toggle.dataset.abSettingsChangeBound = "1";
      refs.toggle.addEventListener("change", function () {
        const on = refs.toggle.checked;
        refs.toggle.disabled = true;
        if (refs.statusEl) refs.statusEl.textContent = "Сохранение…";
        patchSettings(
          { maintenance_enabled: on },
          function (d) {
            refs.toggle.disabled = false;
            refs.toggle.checked = !!d.maintenance_enabled;
            if (refs.blogToggle) refs.blogToggle.checked = !!d.blog_enabled;
            if (refs.statusEl) refs.statusEl.textContent = "Сохранено";
            setTimeout(function () {
              if (refs.statusEl && refs.statusEl.textContent === "Сохранено") refs.statusEl.textContent = "";
            }, 2000);
          },
          function (d) {
            refs.toggle.disabled = false;
            refs.toggle.checked = !on;
            if (refs.statusEl) refs.statusEl.textContent = d.error || "Не удалось сохранить";
          },
        );
      });
    }

    if (refs.blogToggle && refs.blogToggle.dataset.abSettingsChangeBound !== "1") {
      refs.blogToggle.dataset.abSettingsChangeBound = "1";
      refs.blogToggle.addEventListener("change", function () {
        const on = refs.blogToggle.checked;
        refs.blogToggle.disabled = true;
        if (refs.blogStatusEl) refs.blogStatusEl.textContent = "Сохранение…";
        patchSettings(
          { blog_enabled: on },
          function (d) {
            refs.blogToggle.disabled = false;
            refs.blogToggle.checked = !!d.blog_enabled;
            if (refs.toggle) refs.toggle.checked = !!d.maintenance_enabled;
            if (refs.blogStatusEl) refs.blogStatusEl.textContent = "Сохранено";
            setTimeout(function () {
              if (refs.blogStatusEl && refs.blogStatusEl.textContent === "Сохранено") {
                refs.blogStatusEl.textContent = "";
              }
            }, 2000);
          },
          function (d) {
            refs.blogToggle.disabled = false;
            refs.blogToggle.checked = !on;
            if (refs.blogStatusEl) refs.blogStatusEl.textContent = d.error || "Не удалось сохранить";
          },
        );
      });
    }
  };
})();
