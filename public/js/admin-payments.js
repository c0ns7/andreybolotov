(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";

  /** Декоративные иконки (фиксированный SVG) */
  const ICO = {
    raffle:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
    rub:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
    user:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
    tickets:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"></path><path d="M13 5v2M13 17v2M13 11v2"></path></svg>',
    bank:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01"></path></svg>',
    receipt:
      '<svg class="admin-payment-ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"></path></svg>',
    check:
      '<svg class="admin-payment-btn__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    x:
      '<svg class="admin-payment-btn__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"></path></svg>',
    inbox:
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
    chat:
      '<svg class="admin-payment-btn__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
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

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function loadList() {
    const listEl = document.getElementById("admin-payments-list");
    if (!listEl) return;
    const s = loadSession();
    if (!s || !s.token) {
      listEl.innerHTML =
        '<div class="admin-payments-empty admin-payments-empty--soft"><p>Нет сессии</p></div>';
      return;
    }
    listEl.innerHTML =
      '<div class="admin-payments-skeleton" aria-busy="true">' +
      '<div class="admin-payments-skeleton__line"></div>' +
      '<div class="admin-payments-skeleton__line admin-payments-skeleton__line--short"></div>' +
      "</div>";
    fetch("/api/admin/raffle-payments", {
      headers: { Authorization: "Bearer " + s.token },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (x) {
        if (!x.ok) throw new Error(x.data.error || "Ошибка");
        const payments = x.data.payments || [];
        if (!payments.length) {
          listEl.innerHTML =
            '<div class="admin-payments-empty">' +
            '<div class="admin-payments-empty__illu">' +
            ICO.inbox +
            "</div>" +
            "<p class=\"admin-payments-empty__title\">Очередь пуста</p>" +
            "<p class=\"admin-payments-empty__hint\">Новые заявки с чеками появятся здесь автоматически.</p>" +
            "</div>";
          return;
        }
        listEl.innerHTML = payments.map(function (p) {
          return renderCard(p);
        }).join("");
        listEl.querySelectorAll("[data-confirm-order]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            const id = Number(btn.getAttribute("data-confirm-order"));
            confirmOrReject(s.token, id, "confirm");
          });
        });
        listEl.querySelectorAll("[data-reject-order]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            const id = Number(btn.getAttribute("data-reject-order"));
            confirmOrReject(s.token, id, "reject");
          });
        });
        listEl.querySelectorAll("[data-chat-user]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var uid = Number(btn.getAttribute("data-chat-user"));
            if (!Number.isFinite(uid)) return;
            if (typeof window.abAdminOpenSupportChat === "function") {
              window.abAdminOpenSupportChat(uid);
            }
          });
        });
      })
      .catch(function (e) {
        listEl.innerHTML =
          '<div class="admin-payments-empty admin-payments-empty--error">' +
          '<div class="admin-payments-empty__illu admin-payments-empty__illu--warn">' +
          ICO.inbox +
          "</div>" +
          "<p class=\"admin-payments-empty__title\">Не удалось загрузить</p>" +
          "<p class=\"admin-payments-empty__hint\">" +
          esc(String(e.message || "Ошибка")) +
          "</p></div>";
      });
  }

  function renderCard(p) {
    const receipt = p.receipt_url
      ? '<a href="' +
        esc(String(p.receipt_url)) +
        '" target="_blank" rel="noopener noreferrer" class="admin-payment-card__receipt-link">' +
        ICO.receipt +
        "<span>Открыть чек</span>" +
        '<span class="admin-payment-card__receipt-arrow" aria-hidden="true">↗</span></a>'
      : '<span class="admin-payment-card__receipt-miss">' +
        ICO.receipt +
        "<span>Чек не прикреплён</span></span>";
    const bankLabel =
      p.bank === "sber" ? "Сбербанк" : p.bank === "other" ? "Другой банк" : "—";
    const id = String(p.id);
    var uid = p.user_id != null ? Number(p.user_id) : NaN;
    var chatBtn =
      Number.isFinite(uid) && uid > 0
        ? '<button type="button" class="admin-payment-btn admin-payment-btn--chat" data-chat-user="' +
          String(uid) +
          '">' +
          ICO.chat +
          "<span>Написать в чат</span></button>"
        : "";
    return (
      '<article class="admin-payment-card" data-order-id="' +
      id +
      '">' +
      '<div class="admin-payment-card__stripe" aria-hidden="true"></div>' +
      '<div class="admin-payment-card__body">' +
      '<header class="admin-payment-card__header">' +
      '<div class="admin-payment-card__raffle">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--violet">' +
      ICO.raffle +
      "</span>" +
      '<div class="admin-payment-card__raffle-text">' +
      '<span class="admin-payment-card__eyebrow">Акция</span>' +
      '<h3 class="admin-payment-card__title">' +
      esc(String(p.raffle_title || "Без названия")) +
      "</h3>" +
      "</div></div>" +
      '<div class="admin-payment-card__sum-block">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--green">' +
      ICO.rub +
      "</span>" +
      '<div><span class="admin-payment-card__eyebrow">Сумма</span>' +
      '<p class="admin-payment-card__sum">' +
      esc(String(p.amount_rub ?? 0)) +
      " <span class=\"admin-payment-card__currency\">₽</span></p></div></div></header>" +
      '<ul class="admin-payment-card__facts">' +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--blue">' +
      ICO.user +
      "</span>" +
      "<span>" +
      esc(String(p.user_name || "—")) +
      " · " +
      esc(String(p.user_phone || "")) +
      "</span></li>" +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--amber">' +
      ICO.tickets +
      "</span>" +
      "<span><strong>" +
      String(p.ticket_count ?? 0) +
      "</strong> номерков</span></li>" +
      '<li class="admin-payment-card__fact">' +
      '<span class="admin-payment-card__icon-wrap admin-payment-card__icon-wrap--slate">' +
      ICO.bank +
      "</span>" +
      "<span>" +
      esc(bankLabel) +
      "</span></li>" +
      '<li class="admin-payment-card__fact admin-payment-card__fact--receipt">' +
      receipt +
      "</li></ul>" +
      '<div class="admin-payment-card__actions">' +
      chatBtn +
      '<button type="button" class="admin-payment-btn admin-payment-btn--confirm" data-confirm-order="' +
      id +
      '">' +
      ICO.check +
      "<span>Подтвердить</span></button>" +
      '<button type="button" class="admin-payment-btn admin-payment-btn--reject" data-reject-order="' +
      id +
      '">' +
      ICO.x +
      "<span>Отклонить</span></button>" +
      "</div></div></article>"
    );
  }

  async function confirmOrReject(token, orderId, kind) {
    const msg =
      kind === "confirm"
        ? "Подтвердить оплату и закрепить номерки за пользователем?"
        : "Отклонить заявку и освободить номерки?";
    if (!window.confirm(msg)) return;
    const path =
      kind === "confirm"
        ? "/api/admin/raffle-payments/" + String(orderId) + "/confirm"
        : "/api/admin/raffle-payments/" + String(orderId) + "/reject";
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "Ошибка");
      await loadList();
    } catch (e) {
      window.alert(String(e.message || "Ошибка"));
    }
  }

  window.abInitPayments = function () {
    loadList();
  };
})();
