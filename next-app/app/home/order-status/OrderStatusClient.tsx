"use client";

import { useEffect } from "react";

function esc(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(ms: number) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try {
    return new Date(n).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function statusRu(st: string) {
  const s = String(st || "");
  if (s === "reserved") return "Бронь, ждём оплату и чек";
  if (s === "pending_review") return "Чек на проверке";
  if (s === "confirmed") return "Оплата закреплена";
  if (s === "rejected") return "Заявка отменена";
  return s || "—";
}

export default function OrderStatusClient() {
  useEffect(() => {
    const root = document.getElementById("order-status-root");
    if (!root) return;

    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      params = new URLSearchParams();
    }
    const t = String(params.get("t") || "").trim();

    if (!t) {
      root.innerHTML =
        '<div class="order-status-card order-status-card--err">' +
        "<p><strong>Ссылка неполная</strong></p>" +
        '<p class="order-status-muted">Откройте страницу из SMS или письма целиком. Если ссылка обрезана, попросите отправить её ещё раз.</p>' +
        "</div>";
      return;
    }

    fetch("/api/public/raffle-order-status?t=" + encodeURIComponent(t), { cache: "no-store" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then((x) => {
        if (!x.ok || !x.d || x.d.found !== true) {
          root.innerHTML =
            '<div class="order-status-card order-status-card--err">' +
            "<p><strong>Заказ не найден</strong></p>" +
            '<p class="order-status-muted">Возможно, ссылка устарела или была скопирована с ошибкой.</p>' +
            "</div>";
          return;
        }
        const d = x.d as Record<string, unknown>;
        const rules = d.rules_url ? String(d.rules_url).trim() : "";
        const rulesBlock = rules
          ? '<p class="order-status-rules"><a href="' +
            esc(rules) +
            '" target="_blank" rel="noopener noreferrer">Краткие правила акции</a></p>'
          : "";
        const hint = d.review_eta_hint ? '<p class="order-status-eta">' + esc(String(d.review_eta_hint)) + "</p>" : "";
        const tl = Array.isArray(d.timeline) ? (d.timeline as Record<string, unknown>[]) : [];
        let tlHtml = "";
        if (tl.length) {
          tlHtml += '<div class="order-status-timeline"><p class="order-status-timeline__title">История</p><ol class="order-status-timeline__list">';
          for (let i = 0; i < tl.length; i++) {
            const it = tl[i] || {};
            const det = it.detail
              ? '<span class="order-status-timeline__detail">' + esc(String(it.detail)) + "</span>"
              : "";
            tlHtml +=
              "<li><strong>" +
              esc(String(it.label || it.kind || "")) +
              '</strong><span class="order-status-timeline__time">' +
              esc(fmt(Number(it.at))) +
              "</span>" +
              det +
              "</li>";
          }
          tlHtml += "</ol></div>";
        }
        const until =
          d.reserved_until != null && Number(d.reserved_until) > 0
            ? '<p class="order-status-muted">Снять бронь нужно до <strong>' +
              esc(fmt(Number(d.reserved_until))) +
              "</strong> (время браузера).</p>"
            : "";
        root.innerHTML =
          '<div class="order-status-card">' +
          '<p class="order-status-pill">' +
          esc(String(d.order_public_id || "")) +
          "</p>" +
          '<h2 class="order-status-h2">' +
          esc(String(d.raffle_title || "Акция")) +
          "</h2>" +
          '<p class="order-status-status"><strong>Статус:</strong> ' +
          esc(statusRu(String(d.status))) +
          "</p>" +
          '<p class="order-status-sum">Сумма: <strong>' +
          esc(String(d.amount_rub ?? "—")) +
          " ₽</strong> · номерков: <strong>" +
          esc(String(d.ticket_count ?? "—")) +
          "</strong></p>" +
          until +
          hint +
          rulesBlock +
          tlHtml +
          "</div>";
      })
      .catch(() => {
        root.innerHTML =
          '<div class="order-status-card order-status-card--err">' +
          "<p><strong>Не удалось загрузить</strong></p>" +
          '<p class="order-status-muted">Проверьте соединение и откройте страницу снова.</p>' +
          "</div>";
      });
  }, []);

  return null;
}
