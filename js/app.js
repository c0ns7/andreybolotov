(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_demo";

  /** @type {{ phone: string, name: string, email: string, password: string } | null} */
  let session = null;

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveSession(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    session = data;
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    session = null;
  }

  // --- Russian phone: display +7 (XXX) XXX-XX-XX
  function digitsOnly(s) {
    return String(s).replace(/\D/g, "");
  }

  function formatRuPhone(input) {
    let d = digitsOnly(input);
    if (d.length === 0) return "";
    if (d[0] === "8") d = "7" + d.slice(1);
    if (d[0] === "9") d = "7" + d;
    if (d[0] !== "7") d = "7" + d.replace(/^7+/, "");
    d = d.slice(0, 11);

    let out = "+7";
    if (d.length > 1) out += " (" + d.slice(1, 4);
    if (d.length >= 4) out += ")";
    if (d.length > 4) out += " " + d.slice(4, 7);
    if (d.length > 7) out += "-" + d.slice(7, 9);
    if (d.length > 9) out += "-" + d.slice(9, 11);
    return out;
  }

  function phoneToNormalized(digits) {
    let d = digitsOnly(digits);
    if (d[0] === "8") d = "7" + d.slice(1);
    if (d[0] === "9") d = "7" + d;
    if (d[0] !== "7") d = "7" + d.replace(/^7+/, "");
    return d.slice(0, 11);
  }

  function bindPhoneInput(el) {
    if (!el) return;
    el.addEventListener("input", function () {
      const start = el.selectionStart;
      const before = el.value;
      const formatted = formatRuPhone(el.value);
      el.value = formatted;
      try {
        const diff = formatted.length - before.length;
        if (start != null) el.setSelectionRange(start + diff, start + diff);
      } catch (_) {}
    });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && el.value === "+7 ") {
        e.preventDefault();
        el.value = "";
      }
    });
  }

  function bindPasswordToggle(btn, inputId) {
    if (!btn) return;
    btn.addEventListener("click", function () {
      const input = document.getElementById(inputId);
      if (!input) return;
      const isPwd = input.type === "password";
      input.type = isPwd ? "text" : "password";
      btn.setAttribute("aria-pressed", String(isPwd));
      btn.querySelector(".eye-open").style.display = isPwd ? "none" : "inline";
      btn.querySelector(".eye-closed").style.display = isPwd ? "inline" : "none";
    });
  }

  // --- DOM
  const welcomeScreen = document.getElementById("screen-welcome");
  const appScreen = document.getElementById("screen-app");

  const modalRegister = document.getElementById("modal-register");
  const modalLogin = document.getElementById("modal-login");
  const modalForgot = document.getElementById("modal-forgot");

  const btnRegisterMain = document.getElementById("btn-register-main");
  const btnLoginLink = document.getElementById("btn-login-link");

  const formRegister = document.getElementById("form-register");
  const formLogin = document.getElementById("form-login");
  const formForgot = document.getElementById("form-forgot");

  const phoneReg = document.getElementById("phone-reg");
  const phoneLogin = document.getElementById("phone-login");

  bindPhoneInput(phoneReg);
  bindPhoneInput(phoneLogin);

  bindPasswordToggle(document.getElementById("toggle-pass-reg"), "pass-reg");
  bindPasswordToggle(document.getElementById("toggle-pass-reg2"), "pass-reg2");
  bindPasswordToggle(document.getElementById("toggle-pass-login"), "pass-login");

  function openModal(overlay) {
    if (!overlay) return;
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal(overlay) {
    if (!overlay) return;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function closeAllModals() {
    [modalRegister, modalLogin, modalForgot].forEach(closeModal);
  }

  var TOAST_SVG = {
    success:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    neutral:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  };

  function ensureToastEl() {
    var t = document.getElementById("toast");
    if (t) return t;
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");
    t.setAttribute("aria-atomic", "true");
    t.innerHTML =
      '<span class="toast__icon" aria-hidden="true"></span><span class="toast__text"></span>';
    t.addEventListener("click", function (e) {
      e.preventDefault();
      dismissToast();
    });
    document.body.appendChild(t);
    return t;
  }

  function dismissToast() {
    var t = document.getElementById("toast");
    if (!t || !t.classList.contains("is-visible")) return;
    clearTimeout(showToast._tid);
    showToast._tid = null;
    t.classList.add("is-exiting");
    var finished = false;
    function done() {
      if (finished) return;
      finished = true;
      t.classList.remove("is-visible", "is-exiting");
      t.removeEventListener("transitionend", onEnd);
    }
    function onEnd(e) {
      if (e.target !== t) return;
      if (e.propertyName !== "transform" && e.propertyName !== "opacity") return;
      done();
    }
    t.addEventListener("transitionend", onEnd);
    window.setTimeout(done, 420);
  }

  function showToast(message, options) {
    var opts = typeof options === "string" ? { type: options } : options || {};
    var type = opts.type || "info";
    var duration = typeof opts.duration === "number" ? opts.duration : 3600;
    var allowed = { success: 1, error: 1, warning: 1, info: 1, neutral: 1 };
    if (!allowed[type]) type = "info";

    var t = ensureToastEl();
    clearTimeout(showToast._tid);
    showToast._tid = null;
    t.classList.remove("is-visible", "is-exiting");
    t.className = "toast toast--" + type;
    t.setAttribute("aria-label", message + ". Нажмите, чтобы закрыть.");
    var iconEl = t.querySelector(".toast__icon");
    var textEl = t.querySelector(".toast__text");
    if (iconEl) iconEl.innerHTML = TOAST_SVG[type] || TOAST_SVG.info;
    if (textEl) textEl.textContent = message;

    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        t.classList.add("is-visible");
      });
    });

    showToast._tid = window.setTimeout(function () {
      dismissToast();
    }, duration);
  }

  function updateScreens() {
    session = loadSession();
    const authed = !!(session && session.phone);
    welcomeScreen.classList.toggle("screen--hidden", authed);
    appScreen.classList.toggle("screen--hidden", !authed);
  }

  // Navigation
  btnRegisterMain.addEventListener("click", function () {
    openModal(modalRegister);
  });

  btnLoginLink.addEventListener("click", function () {
    openModal(modalLogin);
  });

  document.getElementById("modal-reg-close").addEventListener("click", function () {
    closeModal(modalRegister);
  });
  document.getElementById("modal-reg-back").addEventListener("click", function () {
    closeModal(modalRegister);
  });

  document.getElementById("modal-login-close").addEventListener("click", function () {
    closeModal(modalLogin);
  });
  document.getElementById("modal-login-back").addEventListener("click", function () {
    closeModal(modalLogin);
  });

  document.getElementById("link-to-register").addEventListener("click", function (e) {
    e.preventDefault();
    closeModal(modalLogin);
    openModal(modalRegister);
  });

  document.getElementById("link-forgot").addEventListener("click", function (e) {
    e.preventDefault();
    closeModal(modalLogin);
    openModal(modalForgot);
  });

  document.getElementById("modal-forgot-close").addEventListener("click", function () {
    closeModal(modalForgot);
  });
  document.getElementById("modal-forgot-back").addEventListener("click", function () {
    closeModal(modalForgot);
    openModal(modalLogin);
  });

  document.getElementById("link-login-from-reg").addEventListener("click", function (e) {
    e.preventDefault();
    closeModal(modalRegister);
    openModal(modalLogin);
  });

  // Overlay click to close (optional — only top modal)
  [modalRegister, modalLogin, modalForgot].forEach(function (ov) {
    ov.addEventListener("click", function (e) {
      if (e.target === ov) closeModal(ov);
    });
  });

  // Forms
  formRegister.addEventListener("submit", function (e) {
    e.preventDefault();
    const phone = phoneToNormalized(phoneReg.value);
    if (phone.length !== 11) {
      showToast("Введите полный номер телефона", "warning");
      return;
    }
    const name = document.getElementById("fio-reg").value.trim();
    const email = document.getElementById("email-reg").value.trim();
    const p1 = document.getElementById("pass-reg").value;
    const p2 = document.getElementById("pass-reg2").value;
    if (!name) {
      showToast("Укажите ФИО", "warning");
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast("Укажите корректный email", "warning");
      return;
    }
    if (p1.length < 6) {
      showToast("Пароль не короче 6 символов", "warning");
      return;
    }
    if (p1 !== p2) {
      showToast("Пароли не совпадают", "warning");
      return;
    }
    saveSession({ phone: phone, name: name, email: email, password: p1 });
    closeAllModals();
    showToast("Добро пожаловать, " + name.split(" ")[0] + "!", "success");
    updateScreens();
    formRegister.reset();
    phoneReg.value = "";
  });

  formLogin.addEventListener("submit", function (e) {
    e.preventDefault();
    const phone = phoneToNormalized(phoneLogin.value);
    if (phone.length !== 11) {
      showToast("Введите полный номер телефона", "warning");
      return;
    }
    const pass = document.getElementById("pass-login").value;
    if (!pass) {
      showToast("Введите пароль", "warning");
      return;
    }
    const saved = loadSession();
    if (!saved || saved.phone !== phone || saved.password !== pass) {
      showToast("Неверный телефон или пароль", "error");
      return;
    }
    closeAllModals();
    showToast("С возвращением!", "success");
    updateScreens();
    formLogin.reset();
    phoneLogin.value = "";
  });

  formForgot.addEventListener("submit", function (e) {
    e.preventDefault();
    const email = document.getElementById("email-forgot").value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast("Введите email", "warning");
      return;
    }
    closeModal(modalForgot);
    openModal(modalLogin);
    showToast("Если email найден, мы отправим ссылку (в демо письма нет)", "info");
    formForgot.reset();
  });

  const logoBtn = document.getElementById("logo-btn");
  logoBtn.addEventListener("click", function (e) {
    e.preventDefault();
  });
  logoBtn.addEventListener("dblclick", function () {
    clearSession();
    updateScreens();
    showToast("Вы вышли из аккаунта (демо)", "neutral");
  });

  updateScreens();
})();
