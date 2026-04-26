"use client";

import { useEffect } from "react";
import { abApiJson, abAuthHeaders, AbApiError } from "../../lib/ab-api";
import { loadAbSession } from "../../lib/ab-session";
export default function SettingsPageClient() {
  useEffect(() => {
    const root = document.getElementById("settings-page-root");
    if (!root || root.getAttribute("data-settings-native") === "1") return;
    root.setAttribute("data-settings-native", "1");

    const tabs = root.querySelectorAll(".settings-tabs [role='tab']");
    const panels = root.querySelectorAll(".settings-tab-panel");
    function activate(id: string) {
      const safeId = id && String(id).trim() ? String(id).trim() : "password";
      tabs.forEach((t) => {
        const el = t as HTMLElement;
        const on = el.getAttribute("data-tab") === safeId;
        el.setAttribute("aria-selected", on ? "true" : "false");
        el.tabIndex = on ? 0 : -1;
      });
      panels.forEach((p) => {
        const el = p as HTMLElement;
        const on = el.id === "settings-panel-" + safeId;
        el.hidden = !on;
      });
    }
    tabs.forEach((tab) => {
      tab.addEventListener("click", function () {
        activate((tab as HTMLElement).getAttribute("data-tab") || "password");
      });
      tab.addEventListener("keydown", function (e) {
        const ev = e as KeyboardEvent;
        const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
        if (keys.indexOf(ev.key) === -1) return;
        ev.preventDefault();
        const list = Array.prototype.slice.call(tabs) as HTMLElement[];
        const i = list.indexOf(tab as HTMLElement);
        let next = i;
        if (ev.key === "ArrowRight") next = (i + 1) % list.length;
        else if (ev.key === "ArrowLeft") next = (i - 1 + list.length) % list.length;
        else if (ev.key === "Home") next = 0;
        else if (ev.key === "End") next = list.length - 1;
        list[next].focus();
        activate(list[next].getAttribute("data-tab") || "password");
      });
    });
    activate("password");

    function wirePasswordToggle(inputId: string, toggleId: string) {
      const inp = document.getElementById(inputId) as HTMLInputElement | null;
      const btn = document.getElementById(toggleId) as HTMLButtonElement | null;
      if (!inp || !btn) return;
      const sync = () => {
        const show = inp.type === "text";
        btn.setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
        btn.classList.toggle("is-active", show);
      };
      sync();
      btn.addEventListener("click", () => {
        inp.type = inp.type === "password" ? "text" : "password";
        sync();
      });
    }
    wirePasswordToggle("settings-current-password", "settings-current-password-toggle");
    wirePasswordToggle("settings-new-password", "settings-new-password-toggle");
    wirePasswordToggle("settings-new-password2", "settings-new-password2-toggle");

    const statusTimers = new Map<string, ReturnType<typeof setTimeout>>();
    function setToggleStatus(id: string, text: string, kind: "saving" | "ok" | "err" | "") {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.classList.remove("settings-option__status--saving", "settings-option__status--ok", "settings-option__status--err");
      if (kind) el.classList.add("settings-option__status--" + kind);
      const prev = statusTimers.get(id);
      if (prev) clearTimeout(prev);
      if (kind === "ok") {
        const t = setTimeout(() => {
          const e2 = document.getElementById(id);
          if (!e2) return;
          e2.textContent = "";
          e2.classList.remove("settings-option__status--ok");
          statusTimers.delete(id);
        }, 1400);
        statusTimers.set(id, t);
      }
    }

    function setTheme(mode: "light" | "dark") {
      const r = document.documentElement;
      if (mode === "dark") {
        r.classList.add("theme-dark");
        try {
          localStorage.setItem("ab_theme", "dark");
        } catch {
          /* ignore */
        }
      } else {
        r.classList.remove("theme-dark");
        try {
          localStorage.setItem("ab_theme", "light");
        } catch {
          /* ignore */
        }
      }
      syncThemeButtons(mode);
    }
    function readTheme(): "light" | "dark" {
      try {
        return localStorage.getItem("ab_theme") === "dark" ? "dark" : "light";
      } catch {
        return "light";
      }
    }
    function syncThemeButtons(mode: "light" | "dark") {
      const light = document.getElementById("settings-theme-light");
      const dark = document.getElementById("settings-theme-dark");
      if (light) {
        light.setAttribute("aria-pressed", mode === "light" ? "true" : "false");
        light.classList.toggle("settings-seg__btn--active", mode === "light");
      }
      if (dark) {
        dark.setAttribute("aria-pressed", mode === "dark" ? "true" : "false");
        dark.classList.toggle("settings-seg__btn--active", mode === "dark");
      }
    }
    syncThemeButtons(readTheme());
    document.getElementById("settings-theme-light")?.addEventListener("click", () => setTheme("light"));
    document.getElementById("settings-theme-dark")?.addEventListener("click", () => setTheme("dark"));

    function setA11yFlag(key: string, className: string, on: boolean) {
      const r = document.documentElement;
      if (on) {
        r.classList.add(className);
        try {
          localStorage.setItem(key, "1");
        } catch {
          /* ignore */
        }
      } else {
        r.classList.remove(className);
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      }
    }
    function readFlag(key: string) {
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    }
    const cbLarge = document.getElementById("settings-a11y-large") as HTMLInputElement | null;
    const cbContrast = document.getElementById("settings-a11y-contrast") as HTMLInputElement | null;
    const cbMotion = document.getElementById("settings-a11y-motion") as HTMLInputElement | null;
    if (cbLarge) {
      cbLarge.checked = readFlag("ab_a11y_large");
      cbLarge.addEventListener("change", () => {
        setA11yFlag("ab_a11y_large", "a11y-large-text", cbLarge.checked);
        setToggleStatus("settings-a11y-large-status", "Сохранено", "ok");
      });
    }
    if (cbContrast) {
      cbContrast.checked = readFlag("ab_a11y_contrast");
      cbContrast.addEventListener("change", () => {
        setA11yFlag("ab_a11y_contrast", "a11y-high-contrast", cbContrast.checked);
        setToggleStatus("settings-a11y-contrast-status", "Сохранено", "ok");
      });
    }
    if (cbMotion) {
      cbMotion.checked = readFlag("ab_a11y_reduce_motion");
      cbMotion.addEventListener("change", () => {
        setA11yFlag("ab_a11y_reduce_motion", "reduce-motion", cbMotion.checked);
        setToggleStatus("settings-a11y-motion-status", "Сохранено", "ok");
      });
    }

    function saveEmailNotify(patch: Record<string, boolean>) {
      const errEl = document.getElementById("settings-notify-error");
      if (errEl) {
        errEl.textContent = "";
        errEl.hidden = true;
      }
      return abApiJson("/api/auth/email-notifications", {
        method: "PATCH",
        headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch((er: unknown) => {
        if (errEl) {
          errEl.textContent = er instanceof AbApiError ? er.message : "Не удалось сохранить";
          errEl.hidden = false;
        }
        throw er;
      });
    }

    const cbNotifyChat = document.getElementById("settings-notify-chat") as HTMLInputElement | null;
    const cbNotifyRaffles = document.getElementById("settings-notify-raffles") as HTMLInputElement | null;
    const cbNotifyRaffleOrders = document.getElementById("settings-notify-raffle-orders") as HTMLInputElement | null;
    const sessNotify = loadAbSession();
    if (sessNotify?.token) {
      abApiJson<{ user: Record<string, unknown> }>("/api/auth/me", { headers: abAuthHeaders(), cache: "no-store" })
        .then((data) => {
          const u = (data && data.user) || {};
          if (cbNotifyChat) cbNotifyChat.checked = u.email_notify_chat !== false;
          if (cbNotifyRaffles) cbNotifyRaffles.checked = u.email_notify_raffles !== false;
          if (cbNotifyRaffleOrders) cbNotifyRaffleOrders.checked = u.email_notify_raffle_orders !== false;
        })
        .catch(() => {});
    } else {
      if (cbNotifyChat) cbNotifyChat.disabled = true;
      if (cbNotifyRaffles) cbNotifyRaffles.disabled = true;
      if (cbNotifyRaffleOrders) cbNotifyRaffleOrders.disabled = true;
    }
    if (cbNotifyChat && sessNotify?.token) {
      cbNotifyChat.addEventListener("change", () => {
        const want = cbNotifyChat.checked;
        setToggleStatus("settings-notify-chat-status", "Сохраняем...", "saving");
        saveEmailNotify({ email_notify_chat: want })
          .then(() => {
            setToggleStatus("settings-notify-chat-status", "Сохранено", "ok");
          })
          .catch(() => {
            cbNotifyChat.checked = !want;
            setToggleStatus("settings-notify-chat-status", "Ошибка", "err");
          });
      });
    }
    if (cbNotifyRaffles && sessNotify?.token) {
      cbNotifyRaffles.addEventListener("change", () => {
        const want = cbNotifyRaffles.checked;
        setToggleStatus("settings-notify-raffles-status", "Сохраняем...", "saving");
        saveEmailNotify({ email_notify_raffles: want })
          .then(() => {
            setToggleStatus("settings-notify-raffles-status", "Сохранено", "ok");
          })
          .catch(() => {
            cbNotifyRaffles.checked = !want;
            setToggleStatus("settings-notify-raffles-status", "Ошибка", "err");
          });
      });
    }
    if (cbNotifyRaffleOrders && sessNotify?.token) {
      cbNotifyRaffleOrders.addEventListener("change", () => {
        const want = cbNotifyRaffleOrders.checked;
        setToggleStatus("settings-notify-raffle-orders-status", "Сохраняем...", "saving");
        saveEmailNotify({ email_notify_raffle_orders: want })
          .then(() => {
            setToggleStatus("settings-notify-raffle-orders-status", "Сохранено", "ok");
          })
          .catch(() => {
            cbNotifyRaffleOrders.checked = !want;
            setToggleStatus("settings-notify-raffle-orders-status", "Ошибка", "err");
          });
      });
    }

    const formPw = document.getElementById("form-settings-password");
    const onPwSubmit = (e: Event) => {
      e.preventDefault();
      const cur = (document.getElementById("settings-current-password") as HTMLInputElement).value;
      const n1 = (document.getElementById("settings-new-password") as HTMLInputElement).value;
      const n2 = (document.getElementById("settings-new-password2") as HTMLInputElement).value;
      const err = document.getElementById("settings-password-error");
      const ok = document.getElementById("settings-password-ok");
      const btn = document.getElementById("settings-password-submit") as HTMLButtonElement;
      if (err) {
        err.textContent = "";
        err.hidden = true;
      }
      if (ok) ok.hidden = true;
      if (n1.length < 6) {
        if (err) {
          err.textContent = "Новый пароль не короче 6 символов";
          err.hidden = false;
        }
        return;
      }
      if (n1 !== n2) {
        if (err) {
          err.textContent = "Новый пароль и подтверждение не совпадают";
          err.hidden = false;
        }
        return;
      }
      btn.disabled = true;
      btn.textContent = "Сохранение…";
      abApiJson("/api/auth/change-password", {
        method: "POST",
        headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: cur, new_password: n1 }),
      })
        .then(() => {
          (document.getElementById("settings-current-password") as HTMLInputElement).value = "";
          (document.getElementById("settings-new-password") as HTMLInputElement).value = "";
          (document.getElementById("settings-new-password2") as HTMLInputElement).value = "";
          if (ok) ok.hidden = false;
        })
        .catch((er: unknown) => {
          if (err) {
            err.textContent = er instanceof AbApiError ? er.message : "Не удалось сменить пароль";
            err.hidden = false;
          }
        })
        .finally(() => {
          btn.disabled = false;
          btn.textContent = "Сохранить пароль";
        });
    };
    formPw?.addEventListener("submit", onPwSubmit);

    return () => {
      formPw?.removeEventListener("submit", onPwSubmit);
    };
  }, []);

  return null;
}
