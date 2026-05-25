import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { formatRuSiteDateTime } from "./site-timezone.js";

function smtpDebugEnabled(): boolean {
  const v = String(process.env.SMTP_DEBUG ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function smtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = String(process.env.SMTP_PASS ?? "").trim();
  return Boolean(host && user && pass);
}

export function isSmtpReady(): boolean {
  return smtpConfigured();
}

function smtpFromAddress(): string {
  const user = String(process.env.SMTP_USER ?? "").trim();
  return process.env.SMTP_FROM?.trim() || user;
}

function createTransporter(): Transporter {
  /** Везде .trim() как в smtpConfigured(), иначе проверка «SMTP есть» проходит, а auth падает из‑за пробелов/переноса в .env */
  const host = String(process.env.SMTP_HOST ?? "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER ?? "").trim();
  const pass = String(process.env.SMTP_PASS ?? "").trim();
  const requireTls = String(process.env.SMTP_REQUIRE_TLS ?? "").trim() !== "0";
  const smtpLogger = smtpDebugEnabled()
    ? {
        debug: (msg: unknown) => console.log("[smtp]", msg),
        info: (msg: unknown) => console.log("[smtp]", msg),
        warn: (msg: unknown) => console.warn("[smtp]", msg),
        error: (msg: unknown) => console.error("[smtp]", msg),
      }
    : undefined;
  const transportOpts = {
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    ...(port === 587 && requireTls ? { requireTLS: true } : {}),
    ...(String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED ?? "").trim() === "0"
      ? { tls: { rejectUnauthorized: false } }
      : {}),
    ...(smtpDebugEnabled() ? { debug: true, logger: smtpLogger } : {}),
  };
  return nodemailer.createTransport(
    transportOpts as Parameters<typeof nodemailer.createTransport>[0],
  );
}

function logMailFailureLine(line: string): void {
  try {
    const raw = process.env.MAIL_FAILURE_LOG?.trim();
    const file = raw || path.join(process.cwd(), "data", "mail-failures.log");
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch (e) {
    console.error("[mail] cannot write failure log", e);
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendTransactionalMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (!smtpConfigured()) {
    throw new Error("SMTP не настроен (SMTP_HOST, SMTP_USER, SMTP_PASS)");
  }
  const transporter = createTransporter();
  const from = smtpFromAddress();
  const maxAttempts = Math.min(Math.max(Number(process.env.SMTP_MAX_ATTEMPTS ?? "3"), 1), 5);
  let lastDetail = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await transporter.sendMail({
        from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
      return;
    } catch (e: unknown) {
      const err = e as { message?: string; response?: string; responseCode?: string | number };
      const parts = [
        err.message,
        err.responseCode != null ? `code=${err.responseCode}` : "",
        err.response ? `resp=${String(err.response).slice(0, 500)}` : "",
      ].filter(Boolean);
      lastDetail = parts.join(" | ") || String(e);
      console.error("[mail] sendMail failed (attempt " + String(attempt) + "):", lastDetail);
      logSmtpFailureHint(e);
      if (attempt < maxAttempts) await sleepMs(500 * attempt);
    }
  }
  logMailFailureLine(
    `FAIL to=${opts.to} subject=${String(opts.subject).slice(0, 120)} err=${lastDetail}`,
  );
  throw new Error(lastDetail);
}

/** Расшифровка типичных ответов SMTP в лог (для администратора сервера). */
export function logSmtpFailureHint(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  const resp = String((e as { response?: string }).response ?? "");
  const combined = `${msg} ${resp}`.toLowerCase();
  if (
    combined.includes("application password") ||
    combined.includes("parol prilozheniya") ||
    combined.includes("neobhodim parol")
  ) {
    console.error(
      "[mail] Mail.ru / VK: в SMTP_PASS нужен «Пароль для внешнего приложения», обычный пароль ящика не подходит. Создать: https://help.mail.ru/mail/security/protection/external",
    );
  } else if ((e as { code?: string }).code === "EAUTH" || combined.includes("invalid login")) {
    console.error("[mail] Ошибка AUTH: проверьте SMTP_USER и SMTP_PASS (без лишних пробелов в .env).");
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

/** Даты в письмах — по агинскому (сайтовому) времени. */
export function formatRuMoscowDateTime(ms: number): string {
  return formatRuSiteDateTime(ms);
}

/** Единая вёрстка писем: тёмный хедер, карточка, футер. */
function emailLayout(opts: {
  /** Короткая строка для превью во входящих (скрытый блок) */
  preheader: string;
  /** Заголовок в синей шапке */
  headline: string;
  /** HTML основного блока (уже безопасный) */
  innerHtml: string;
  /** Подпись внизу карточки */
  footerNote: string;
}): string {
  const preRaw = String(opts.preheader ?? "").slice(0, 140);
  const pre = escapeHtml(preRaw);
  const head = escapeHtml(String(opts.headline ?? ""));
  const foot = escapeHtml(String(opts.footerNote ?? ""));
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>${head}</title>
</head>
<body style="margin:0;padding:0;background:#e2e8f0;-webkit-text-size-adjust:100%;">
  <span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;color:#e2e8f0;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${pre}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e2e8f0;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,0.12);">
          <tr>
            <td style="padding:28px 32px 24px;background:linear-gradient(145deg,#0f172a 0%,#1e3a8f 48%,#2563eb 100%);">
              <div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.75);">andreybolotov.ru</div>
              <div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:22px;font-weight:700;line-height:1.25;color:#ffffff;margin-top:10px;">${head}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#334155;">
              ${opts.innerHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 28px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:12px;line-height:1.5;color:#94a3b8;border-top:1px solid #f1f5f9;">
              ${foot}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;">
  <tr>
    <td style="border-radius:12px;background:#2563eb;">
      <a href="${escapeHtmlAttr(href)}" style="display:inline-block;padding:14px 28px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

function emailExtraLinksText(statusUrl?: string, rulesUrl?: string): string {
  const r = String(rulesUrl ?? "").trim();
  const s = String(statusUrl ?? "").trim();
  const lines: string[] = [];
  if (s) lines.push("Статус заказа: " + s);
  if (r) lines.push("Правила акции: " + r);
  return lines.length ? "\n\n" + lines.join("\n") : "";
}

function emailExtraLinksHtml(statusUrl?: string, rulesUrl?: string): string {
  const r = String(rulesUrl ?? "").trim();
  const s = String(statusUrl ?? "").trim();
  if (!r && !s) return "";
  let out =
    '<div style="margin:16px 0 0;padding:12px 14px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;font-size:13px;color:#475569;line-height:1.5;">';
  if (s) {
    out += `<div style="margin-bottom:6px;"><strong>Статус заказа:</strong> <a href="${escapeHtmlAttr(s)}" style="color:#2563eb;">открыть страницу</a></div>`;
  }
  if (r) {
    out += `<div><strong>Правила акции:</strong> <a href="${escapeHtmlAttr(r)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(r)}</a></div>`;
  }
  out += "</div>";
  return out;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const subject = "Восстановление пароля";
  const text = [
    "Здравствуйте!",
    "",
    "Чтобы задать новый пароль, перейдите по ссылке:",
    resetUrl,
    "",
    "Если вы не запрашивали сброс, проигнорируйте это письмо.",
    "Ссылка действует 1 час. После успешной смены пароля её нужно запросить заново.",
  ].join("\n");

  const inner =
    `<p style="margin:0 0 12px;">Здравствуйте!</p>
<p style="margin:0 0 20px;">Нажмите кнопку ниже, чтобы перейти на страницу смены пароля. Ссылка действует <strong>1 час</strong>; страницу можно открыть повторно, пока не сохраните новый пароль.</p>` +
    ctaButton(resetUrl, "Задать новый пароль") +
    `<p style="margin:16px 0 0;font-size:13px;color:#64748b;">Если кнопка не работает, скопируйте адрес в браузер:<br/><span style="word-break:break-all;">${escapeHtml(resetUrl)}</span></p>`;

  const html = emailLayout({
    preheader: "Ссылка для смены пароля на andreybolotov.ru",
    headline: "Восстановление пароля",
    innerHtml: inner,
    footerNote:
      "Если вы не запрашивали сброс пароля, просто удалите это письмо — аккаунт останется под вашим контролем.",
  });

  await sendTransactionalMail({ to, subject, text, html });
}

export type StaffReplyEmailOpts = {
  to: string;
  name: string;
  /** Текст ответа поддержки (как в чате) */
  body: string;
  /** Строка про вложение или null */
  attachmentHint: string | null;
  openChatUrl: string;
};

export async function sendStaffChatReplyEmail(opts: StaffReplyEmailOpts): Promise<void> {
  const greeting = opts.name.trim() ? `Здравствуйте, ${opts.name.trim()}!` : "Здравствуйте!";
  const bodyRaw = String(opts.body ?? "").trim();
  const maxBody = 6000;
  const clipped = bodyRaw.length > maxBody ? bodyRaw.slice(0, maxBody) + "\n…" : bodyRaw;
  const bodyEsc = escapeHtml(clipped).replace(/\r\n|\n|\r/g, "<br/>");
  const attHint = opts.attachmentHint != null ? String(opts.attachmentHint).trim() : "";

  const parts: string[] = [];
  parts.push(`<p style="margin:0 0 8px;">${escapeHtml(greeting)}</p>`);
  parts.push(
    `<p style="margin:0 0 16px;color:#64748b;font-size:14px;">Вам ответила поддержка сайта. Ниже — то же сообщение, что в чате.</p>`,
  );
  if (attHint) {
    parts.push(
      `<div style="margin:0 0 16px;padding:12px 14px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;font-size:14px;color:#475569;">${escapeHtml(attHint)}</div>`,
    );
  }
  if (clipped) {
    parts.push(
      `<div style="margin:0 0 20px;padding:16px 18px;background:#f1f5f9;border-radius:14px;border-left:4px solid #2563eb;font-size:15px;line-height:1.55;color:#1e293b;word-break:break-word;">${bodyEsc}</div>`,
    );
  } else if (!attHint) {
    parts.push(`<p style="margin:0 0 20px;color:#64748b;">(пустое сообщение)</p>`);
  }
  parts.push(ctaButton(opts.openChatUrl, "Открыть чат в приложении"));
  parts.push(
    `<p style="margin:16px 0 0;font-size:13px;color:#64748b;">Отключить такие письма: <strong>Настройки</strong> → <strong>Почта</strong> → «Чат поддержки».</p>`,
  );
  const inner = parts.join("");

  const oneLine = clipped.replace(/\s+/g, " ").trim();
  const subject =
    oneLine.length > 0
      ? "Чат: " + (oneLine.length > 55 ? oneLine.slice(0, 52) + "…" : oneLine)
      : attHint
        ? "Чат: вложение от поддержки"
        : "Ответ поддержки в чате";

  const textLines = [greeting, "", clipped || "(без текста)"];
  if (attHint) textLines.push("", attHint);
  textLines.push("", "Открыть чат: " + opts.openChatUrl, "", "Отключить уведомления: Настройки → Почта.");
  const text = textLines.join("\n");

  const html = emailLayout({
    preheader: oneLine || attHint || "Новое сообщение от поддержки",
    headline: "Сообщение в чате",
    innerHtml: inner,
    footerNote: "Вы получили это письмо, потому что включены уведомления о чате на andreybolotov.ru.",
  });

  await sendTransactionalMail({ to: opts.to, subject, text, html });
}

export async function sendRaffleLaunchedEmail(
  to: string,
  name: string,
  raffleTitle: string,
  raffleUrl: string,
): Promise<void> {
  const greeting = name.trim() ? `Здравствуйте, ${name.trim()}!` : "Здравствуйте!";
  const title = String(raffleTitle || "Акция").trim();
  const subject = `Новая акция: ${title.length > 45 ? title.slice(0, 42) + "…" : title}`;
  const text = [
    greeting,
    "",
    "На сайте доступна новая акция:",
    title,
    "",
    "Подробности и участие:",
    raffleUrl,
  ].join("\n");

  const inner =
    `<p style="margin:0 0 8px;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 16px;color:#64748b;font-size:14px;">На сайте появилась новая акция — можно перейти к участию в один клик.</p>
<div style="margin:0 0 20px;padding:18px 20px;background:linear-gradient(135deg,#eff6ff 0%,#f8fafc 100%);border-radius:14px;border:1px solid #bfdbfe;">
  <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#3b82f6;margin-bottom:6px;">Акция</div>
  <div style="font-size:18px;font-weight:700;color:#0f172a;line-height:1.35;">${escapeHtml(title)}</div>
</div>` +
    ctaButton(raffleUrl, "Открыть акцию");

  const html = emailLayout({
    preheader: `Новая акция на сайте: ${title}`,
    headline: "Новая акция",
    innerHtml: inner,
    footerNote: "Служебное уведомление.",
  });

  await sendTransactionalMail({ to, subject, text, html });
}

export async function sendReserveExpiringSoonEmail(opts: {
  to: string;
  name: string;
  raffleTitle: string;
  orderPublicId: string;
  minutesLeft: number;
  amountRub: number;
  ticketCount: number;
  openRaffleUrl: string;
  /** Крайний срок брони, строка по Москве (уже отформатирована) */
  deadlineMoscow: string;
  statusPageUrl?: string;
  rulesUrl?: string;
}): Promise<void> {
  const greeting = opts.name.trim() ? `Здравствуйте, ${opts.name.trim()}!` : "Здравствуйте!";
  const title = String(opts.raffleTitle || "Акция").trim();
  const m = Math.max(1, Math.min(999, Math.floor(opts.minutesLeft)));
  const rub = Number(opts.amountRub) || 0;
  const cnt = Math.max(1, Math.floor(opts.ticketCount));
  const dl = String(opts.deadlineMoscow || "").trim();
  const subject =
    m <= 3
      ? `Осталось около ${m} мин. — завершите оплату по акции`
      : `Скоро истечёт бронь номерков (${m} мин.)`;
  const text = [
    greeting,
    "",
    `По акции «${title}» истекает время брони заказа ${opts.orderPublicId} (к оплате ${rub} ₽, ${cnt} номерков).`,
    `Осталось примерно ${m} мин. Крайний срок по Москве: ${dl}.`,
    "",
    "Перейдите в приложение и отправьте чек, пока номерки зарезервированы:",
    opts.openRaffleUrl,
    emailExtraLinksText(opts.statusPageUrl, opts.rulesUrl),
    "",
    "Отключить такие письма: Настройки → Почта → «Бронь и оплата».",
  ].join("\n");

  const inner =
    `<p style="margin:0 0 8px;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 16px;color:#64748b;font-size:14px;">До конца брони осталось примерно <strong>${m} мин.</strong> Завершите перевод и загрузите чек — иначе номерки снова станут доступны другим.</p>
<p style="margin:0 0 16px;font-size:14px;color:#0f172a;">Крайний срок (московское время): <strong>${escapeHtml(dl)}</strong></p>
<div style="margin:0 0 20px;padding:18px 20px;background:linear-gradient(135deg,#fff7ed 0%,#fffbeb 100%);border-radius:14px;border:1px solid #fed7aa;">
  <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#ea580c;margin-bottom:6px;">Бронь</div>
  <div style="font-size:15px;font-weight:600;color:#0f172a;line-height:1.4;">${escapeHtml(title)}</div>
  <div style="margin-top:10px;font-size:14px;color:#334155;">Заказ <strong>${escapeHtml(opts.orderPublicId)}</strong> · к оплате <strong>${rub} ₽</strong> · <strong>${cnt}</strong> номерков</div>
</div>` +
    ctaButton(opts.openRaffleUrl, "Перейти к оплате") +
    emailExtraLinksHtml(opts.statusPageUrl, opts.rulesUrl) +
    `<p style="margin:16px 0 0;font-size:13px;color:#64748b;">Отключить: <strong>Настройки</strong> → <strong>Почта</strong> → «Бронь и оплата».</p>`;

  const html = emailLayout({
    preheader: `Около ${m} мин. до конца брони — ${title}`,
    headline: "Скоро истечёт бронь",
    innerHtml: inner,
    footerNote:
      "Напоминание отправляется один раз за период брони. После продления брони письмо может прийти снова.",
  });

  await sendTransactionalMail({ to: opts.to, subject, text, html });
}

export async function sendReceiptRejectedReworkEmail(opts: {
  to: string;
  name: string;
  raffleTitle: string;
  orderPublicId: string;
  amountRub: number;
  ticketCount: number;
  openRaffleUrl: string;
  deadlineMoscow: string;
  adminNote?: string;
  statusPageUrl?: string;
  rulesUrl?: string;
}): Promise<void> {
  const greeting = opts.name.trim() ? `Здравствуйте, ${opts.name.trim()}!` : "Здравствуйте!";
  const title = String(opts.raffleTitle || "Акция").trim();
  const rub = Number(opts.amountRub) || 0;
  const cnt = Math.max(1, Math.floor(opts.ticketCount));
  const dl = String(opts.deadlineMoscow || "").trim();
  const note = String(opts.adminNote ?? "").trim();
  const subject = `Замените чек по заказу ${opts.orderPublicId}`;
  const text = [
    greeting,
    "",
    `Чек по заказу ${opts.orderPublicId} в акции «${title}» не принят. Номерки пока закреплены за вами.`,
    `Прикрепите другой чек до ${dl} (московское время).`,
    note ? `\nКомментарий проверки: ${note}` : "",
    "",
    "Откройте страницу акции и загрузите чек снова:",
    opts.openRaffleUrl,
    emailExtraLinksText(opts.statusPageUrl, opts.rulesUrl),
    "",
    "Если не успеете, бронь снимется и номерки станут доступны другим.",
    "",
    "Отключить такие письма: Настройки → Почта → «Бронь и оплата».",
  ].join("\n");

  const noteBlock = note
    ? `<p style="margin:0 0 16px;padding:12px 14px;background:#f1f5f9;border-radius:12px;font-size:14px;color:#0f172a;"><strong>Комментарий проверки:</strong> ${escapeHtml(note)}</p>`
    : "";

  const inner =
    `<p style="margin:0 0 8px;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 16px;color:#64748b;font-size:14px;">Пришлите <strong>другой чек</strong> — предыдущий не подошёл для проверки. Номерки временно остаются за вами.</p>
${noteBlock}
<p style="margin:0 0 16px;font-size:14px;color:#0f172a;">Сделайте это до <strong>${escapeHtml(dl)}</strong> (МСК).</p>
<div style="margin:0 0 20px;padding:18px 20px;background:linear-gradient(135deg,#fef2f2 0%,#fff7ed 100%);border-radius:14px;border:1px solid #fecaca;">
  <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#dc2626;margin-bottom:6px;">Нужен новый чек</div>
  <div style="font-size:15px;font-weight:600;color:#0f172a;line-height:1.4;">${escapeHtml(title)}</div>
  <div style="margin-top:10px;font-size:14px;color:#334155;">Заказ <strong>${escapeHtml(opts.orderPublicId)}</strong> · <strong>${rub} ₽</strong> · <strong>${cnt}</strong> номерков</div>
</div>` +
    ctaButton(opts.openRaffleUrl, "Загрузить чек") +
    emailExtraLinksHtml(opts.statusPageUrl, opts.rulesUrl) +
    `<p style="margin:16px 0 0;font-size:13px;color:#64748b;">Вопросы — ответьте на это письмо или напишите в чат в приложении.</p>`;

  const html = emailLayout({
    preheader: `Замените чек по заказу ${opts.orderPublicId}`,
    headline: "Нужен другой чек",
    innerHtml: inner,
    footerNote: "Письмо отправлено при отклонении чека администратором.",
  });

  await sendTransactionalMail({ to: opts.to, subject, text, html });
}

export async function sendOrderFullyReleasedEmail(opts: {
  to: string;
  name: string;
  raffleTitle: string;
  orderPublicId: string;
  reason: string;
  openHomeUrl: string;
  statusPageUrl?: string;
  rulesUrl?: string;
  adminNote?: string;
}): Promise<void> {
  const greeting = opts.name.trim() ? `Здравствуйте, ${opts.name.trim()}!` : "Здравствуйте!";
  const title = String(opts.raffleTitle || "Акция").trim();
  const note = String(opts.adminNote ?? "").trim();
  const subject = `Заказ ${opts.orderPublicId} отменён`;
  const text = [
    greeting,
    "",
    `Заказ ${opts.orderPublicId} по акции «${title}» больше не активен: ${opts.reason}.`,
    note ? `Комментарий: ${note}` : "",
    "",
    "Номерки снова могут быть доступны другим участникам.",
    "",
    "Главная:",
    opts.openHomeUrl,
    emailExtraLinksText(opts.statusPageUrl, opts.rulesUrl),
    "",
    "Отключить такие письма: Настройки → Почта → «Бронь и оплата».",
  ]
    .filter(Boolean)
    .join("\n");

  const noteBlock = note
    ? `<p style="margin:0 0 16px;padding:12px 14px;background:#f1f5f9;border-radius:12px;font-size:14px;color:#0f172a;"><strong>Комментарий:</strong> ${escapeHtml(note)}</p>`
    : "";

  const inner =
    `<p style="margin:0 0 8px;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 16px;color:#64748b;font-size:14px;">${escapeHtml(opts.reason)}</p>
${noteBlock}
<div style="margin:0 0 20px;padding:18px 20px;background:#f8fafc;border-radius:14px;border:1px solid #e2e8f0;">
  <div style="font-size:15px;font-weight:600;color:#0f172a;line-height:1.4;">${escapeHtml(title)}</div>
  <div style="margin-top:10px;font-size:14px;color:#334155;">Заказ <strong>${escapeHtml(opts.orderPublicId)}</strong></div>
</div>` +
    ctaButton(opts.openHomeUrl, "На главную") +
    emailExtraLinksHtml(opts.statusPageUrl, opts.rulesUrl);

  const html = emailLayout({
    preheader: `Заказ ${opts.orderPublicId} отменён`,
    headline: "Заявка закрыта",
    innerHtml: inner,
    footerNote: "Письмо отправлено при отмене заявки администратором или по лимиту доработок.",
  });

  await sendTransactionalMail({ to: opts.to, subject, text, html });
}