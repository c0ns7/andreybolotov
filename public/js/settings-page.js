(function () {
  "use strict";

  var STORAGE_AUTH = "ab_auth_v2";

  function loadSession() {
    try {
      var raw = localStorage.getItem(STORAGE_AUTH);
      if (!raw) return null;
      var j = JSON.parse(raw);
      if (j && j.token && j.phone) return j;
      return null;
    } catch (_) {
      return null;
    }
  }

  function authHeaders() {
    var x = loadSession();
    if (!x || !x.token) return {};
    return { Authorization: "Bearer " + x.token };
  }

  function apiJson(path, options) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    if (opts.body != null && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body,
      cache: opts.cache !== undefined ? opts.cache : "default",
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error((data && (data.error || data.message)) || "Ошибка запроса");
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function setTheme(mode) {
    var r = document.documentElement;
    if (mode === "dark") {
      r.classList.add("theme-dark");
      try {
        localStorage.setItem("ab_theme", "dark");
      } catch (_) {}
    } else {
      r.classList.remove("theme-dark");
      try {
        localStorage.setItem("ab_theme", "light");
      } catch (_) {}
    }
    syncThemeButtons(mode);
  }

  function readTheme() {
    try {
      return localStorage.getItem("ab_theme") === "dark" ? "dark" : "light";
    } catch (_) {
      return "light";
    }
  }

  function syncThemeButtons(mode) {
    var light = document.getElementById("settings-theme-light");
    var dark = document.getElementById("settings-theme-dark");
    if (light) light.setAttribute("aria-pressed", mode === "light" ? "true" : "false");
    if (dark) dark.setAttribute("aria-pressed", mode === "dark" ? "true" : "false");
    if (light) light.classList.toggle("settings-seg__btn--active", mode === "light");
    if (dark) dark.classList.toggle("settings-seg__btn--active", mode === "dark");
  }

  function setA11yFlag(key, className, on) {
    var r = document.documentElement;
    if (on) {
      r.classList.add(className);
      try {
        localStorage.setItem(key, "1");
      } catch (_) {}
    } else {
      r.classList.remove(className);
      try {
        localStorage.removeItem(key);
      } catch (_) {}
    }
  }

  function readFlag(key) {
    try {
      return localStorage.getItem(key) === "1";
    } catch (_) {
      return false;
    }
  }

  function bindTabs() {
    var tabs = document.querySelectorAll(".settings-tabs [role='tab']");
    var panels = document.querySelectorAll(".settings-tab-panel");
    function activate(id) {
      tabs.forEach(function (t) {
        var on = t.getAttribute("data-tab") === id;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
      });
      panels.forEach(function (p) {
        var on = p.id === "settings-panel-" + id;
        p.hidden = !on;
      });
    }
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        activate(tab.getAttribute("data-tab"));
      });
      tab.addEventListener("keydown", function (e) {
        var keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
        if (keys.indexOf(e.key) === -1) return;
        e.preventDefault();
        var list = Array.prototype.slice.call(tabs);
        var i = list.indexOf(tab);
        var next = i;
        if (e.key === "ArrowRight") next = (i + 1) % list.length;
        else if (e.key === "ArrowLeft") next = (i - 1 + list.length) % list.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = list.length - 1;
        list[next].focus();
        activate(list[next].getAttribute("data-tab"));
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("settings-page-root")) return;

    bindTabs();

    syncThemeButtons(readTheme());
    var tl = document.getElementById("settings-theme-light");
    var td = document.getElementById("settings-theme-dark");
    if (tl)
      tl.addEventListener("click", function () {
        setTheme("light");
      });
    if (td)
      td.addEventListener("click", function () {
        setTheme("dark");
      });

    var cbLarge = document.getElementById("settings-a11y-large");
    var cbContrast = document.getElementById("settings-a11y-contrast");
    var cbMotion = document.getElementById("settings-a11y-motion");
    if (cbLarge) {
      cbLarge.checked = readFlag("ab_a11y_large");
      cbLarge.addEventListener("change", function () {
        setA11yFlag("ab_a11y_large", "a11y-large-text", cbLarge.checked);
      });
    }
    if (cbContrast) {
      cbContrast.checked = readFlag("ab_a11y_contrast");
      cbContrast.addEventListener("change", function () {
        setA11yFlag("ab_a11y_contrast", "a11y-high-contrast", cbContrast.checked);
      });
    }
    if (cbMotion) {
      cbMotion.checked = readFlag("ab_a11y_reduce_motion");
      cbMotion.addEventListener("change", function () {
        setA11yFlag("ab_a11y_reduce_motion", "reduce-motion", cbMotion.checked);
      });
    }

    function saveEmailNotify(patch) {
      var errEl = document.getElementById("settings-notify-error");
      if (errEl) {
        errEl.textContent = "";
        errEl.hidden = true;
      }
      return apiJson("/api/auth/email-notifications", {
        method: "PATCH",
        headers: Object.assign({}, authHeaders(), { "Content-Type": "application/json" }),
        body: JSON.stringify(patch),
      }).catch(function (er) {
        if (errEl) {
          errEl.textContent = (er && er.message) || "Не удалось сохранить";
          errEl.hidden = false;
        }
        throw er;
      });
    }

    var cbNotifyChat = document.getElementById("settings-notify-chat");
    var cbNotifyRaffles = document.getElementById("settings-notify-raffles");
    var cbNotifyRaffleOrders = document.getElementById("settings-notify-raffle-orders");
    var sessNotify = loadSession();
    if (sessNotify && sessNotify.token) {
      apiJson("/api/auth/me", { headers: authHeaders(), cache: "no-store" })
        .then(function (data) {
          var u = (data && data.user) || {};
          if (cbNotifyChat) cbNotifyChat.checked = u.email_notify_chat !== false;
          if (cbNotifyRaffles) cbNotifyRaffles.checked = u.email_notify_raffles !== false;
          if (cbNotifyRaffleOrders) cbNotifyRaffleOrders.checked = u.email_notify_raffle_orders !== false;
        })
        .catch(function () {});
    } else {
      if (cbNotifyChat) cbNotifyChat.disabled = true;
      if (cbNotifyRaffles) cbNotifyRaffles.disabled = true;
      if (cbNotifyRaffleOrders) cbNotifyRaffleOrders.disabled = true;
    }
    if (cbNotifyChat && sessNotify && sessNotify.token) {
      cbNotifyChat.addEventListener("change", function () {
        var want = cbNotifyChat.checked;
        saveEmailNotify({ email_notify_chat: want }).catch(function () {
          cbNotifyChat.checked = !want;
        });
      });
    }
    if (cbNotifyRaffles && sessNotify && sessNotify.token) {
      cbNotifyRaffles.addEventListener("change", function () {
        var want = cbNotifyRaffles.checked;
        saveEmailNotify({ email_notify_raffles: want }).catch(function () {
          cbNotifyRaffles.checked = !want;
        });
      });
    }
    if (cbNotifyRaffleOrders && sessNotify && sessNotify.token) {
      cbNotifyRaffleOrders.addEventListener("change", function () {
        var want = cbNotifyRaffleOrders.checked;
        saveEmailNotify({ email_notify_raffle_orders: want }).catch(function () {
          cbNotifyRaffleOrders.checked = !want;
        });
      });
    }

    var formPw = document.getElementById("form-settings-password");
    if (formPw) {
      formPw.addEventListener("submit", function (e) {
        e.preventDefault();
        var cur = document.getElementById("settings-current-password");
        var n1 = document.getElementById("settings-new-password");
        var n2 = document.getElementById("settings-new-password2");
        var err = document.getElementById("settings-password-error");
        var ok = document.getElementById("settings-password-ok");
        var btn = document.getElementById("settings-password-submit");
        var a = cur ? String(cur.value) : "";
        var b = n1 ? String(n1.value) : "";
        var c = n2 ? String(n2.value) : "";
        if (err) {
          err.textContent = "";
          err.hidden = true;
        }
        if (ok) ok.hidden = true;
        if (b.length < 6) {
          if (err) {
            err.textContent = "Новый пароль не короче 6 символов";
            err.hidden = false;
          }
          return;
        }
        if (b !== c) {
          if (err) {
            err.textContent = "Новый пароль и подтверждение не совпадают";
            err.hidden = false;
          }
          return;
        }
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Сохранение…";
        }
        apiJson("/api/auth/change-password", {
          method: "POST",
          headers: Object.assign({}, authHeaders(), { "Content-Type": "application/json" }),
          body: JSON.stringify({ current_password: a, new_password: b }),
        })
          .then(function () {
            if (cur) cur.value = "";
            if (n1) n1.value = "";
            if (n2) n2.value = "";
            if (ok) ok.hidden = false;
          })
          .catch(function (er) {
            if (err) {
              err.textContent = (er && er.message) || "Не удалось сменить пароль";
              err.hidden = false;
            }
          })
          .finally(function () {
            if (btn) {
              btn.disabled = false;
              btn.textContent = "Сохранить пароль";
            }
          });
      });
    }
  });
})();
