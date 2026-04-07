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

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function loadList() {
    const listEl = document.getElementById("admin-payments-list");
    if (!listEl) return;
    const s = loadSession();
    if (!s || !s.token) {
      listEl.innerHTML = '<p class="admin-payments-empty">Нет сессии</p>';
      return;
    }
    listEl.innerHTML =
      '<p class="admin-payments-empty" style="opacity:0.7">Загрузка…</p>';
    try {
      const res = await fetch("/api/admin/raffle-payments", {
        headers: { Authorization: "Bearer " + s.token },
        cache: "no-store",
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "Ошибка");
      const payments = data.payments || [];
      if (!payments.length) {
        listEl.innerHTML =
          '<p class="admin-payments-empty">Нет заявок на проверку</p>';
        return;
      }
      listEl.innerHTML = payments
        .map(function (p) {
          const receipt = p.receipt_url
            ? '<a href="' +
              esc(String(p.receipt_url)) +
              '" target="_blank" rel="noopener noreferrer" class="admin-payment-card__link">Открыть чек</a>'
            : "—";
          const bankLabel =
            p.bank === "sber" ? "Сбербанк" : p.bank === "other" ? "Другой банк" : "—";
          return (
            '<article class="admin-payment-card" data-order-id="' +
            String(p.id) +
            '">' +
            '<div class="admin-payment-card__head">' +
            '<h3 class="admin-payment-card__title">' +
            esc(String(p.raffle_title || "")) +
            "</h3>" +
            '<span class="admin-payment-card__sum">' +
            esc(String(p.amount_rub ?? 0)) +
            " ₽</span>" +
            "</div>" +
            '<p class="admin-payment-card__user">' +
            esc(String(p.user_name || "")) +
            " · " +
            esc(String(p.user_phone || "")) +
            "</p>" +
            '<p class="admin-payment-card__meta">Номерков: ' +
            String(p.ticket_count ?? 0) +
            " · Банк: " +
            esc(bankLabel) +
            "</p>" +
            '<p class="admin-payment-card__receipt">' +
            receipt +
            "</p>" +
            '<div class="admin-payment-card__actions">' +
            '<button type="button" class="admin-raffle-btn admin-raffle-btn--primary" data-confirm-order="' +
            String(p.id) +
            '">Подтвердить</button>' +
            '<button type="button" class="admin-raffle-btn admin-raffle-btn--danger" data-reject-order="' +
            String(p.id) +
            '">Отклонить</button>' +
            "</div></article>"
          );
        })
        .join("");
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
    } catch (e) {
      listEl.innerHTML =
        '<p class="admin-payments-empty">' + esc(String(e.message || "Ошибка")) + "</p>";
    }
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
