import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

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
  const host = String(process.env.SMTP_HOST).trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER).trim();
  const pass = String(process.env.SMTP_PASS);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    ...(port === 587 ? { requireTLS: true } : {}),
  });
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
  await transporter.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
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
  const pre = escapeHtml(opts.preheader.slice(0, 140));
  const head = escapeHtml(opts.headline);
  const foot = escapeHtml(opts.footerNote);
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

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const subject = "Восстановление пароля";
  const text = [
    "Здравствуйте!",
    "",
    "Чтобы задать новый пароль, перейдите по ссылке:",
    resetUrl,
    "",
    "Если вы не запрашивали сброс, проигнорируйте это письмо.",
    "Ссылка действует 1 час.",
  ].join("\n");

  const inner =
    `<p style="margin:0 0 12px;">Здравствуйте!</p>
<p style="margin:0 0 20px;">Нажмите кнопку ниже, чтобы перейти на страницу смены пароля. Ссылка одноразовая и действует <strong>1 час</strong>.</p>` +
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
    "",
    "Отключить рассылку: Настройки → Почта → «Новые акции».",
  ].join("\n");

  const inner =
    `<p style="margin:0 0 8px;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 16px;color:#64748b;font-size:14px;">На сайте появилась новая акция — можно перейти к участию в один клик.</p>
<div style="margin:0 0 20px;padding:18px 20px;background:linear-gradient(135deg,#eff6ff 0%,#f8fafc 100%);border-radius:14px;border:1px solid #bfdbfe;">
  <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#3b82f6;margin-bottom:6px;">Акция</div>
  <div style="font-size:18px;font-weight:700;color:#0f172a;line-height:1.35;">${escapeHtml(title)}</div>
</div>` +
    ctaButton(raffleUrl, "Открыть акцию") +
    `<p style="margin:16px 0 0;font-size:13px;color:#64748b;">Отключить письма о новых акциях: <strong>Настройки</strong> → <strong>Почта</strong>.</p>`;

  const html = emailLayout({
    preheader: `Новая акция на сайте: ${title}`,
    headline: "Новая акция",
    innerHtml: inner,
    footerNote: "Рассылка отправлена один раз при появлении акции на главной. Настройки можно изменить в любой момент.",
  });

  await sendTransactionalMail({ to, subject, text, html });
}