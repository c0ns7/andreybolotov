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

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const subject = "Восстановление пароля";
  const text = [
    "Здравствуйте!",
    "",
    "Чтобы задать новый пароль, перейдите по ссылке:",
    resetUrl,
    "",
    "Если вы не запрашивали сброс, проигнорируйте это письмо.",
    "",
    "Ссылка действует 1 час.",
  ].join("\n");

  const html = `<p>Здравствуйте!</p>
<p>Чтобы задать новый пароль, нажмите:</p>
<p><a href="${escapeHtmlAttr(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
<p style="color:#64748b;font-size:14px;">Если вы не запрашивали сброс, проигнорируйте это письмо. Ссылка действует 1 час.</p>`;

  await sendTransactionalMail({ to, subject, text, html });
}

/** Непрочитанные сообщения поддержки в чате (напоминание на почту). */
export async function sendChatUnreadReminderEmail(
  to: string,
  name: string,
  openChatUrl: string,
): Promise<void> {
  const subject = "Вам ответили в чате поддержки";
  const greeting = name.trim() ? `Здравствуйте, ${name.trim()}!` : "Здравствуйте!";
  const text = [
    greeting,
    "",
    "У вас есть непрочитанные сообщения от поддержки в личном чате на сайте.",
    "Откройте приложение и вкладку «Чат», чтобы прочитать ответ:",
    openChatUrl,
    "",
    "Это письмо отправлено автоматически. Отключить такие уведомления можно в разделе «Настройки» → «Уведомления на почту».",
  ].join("\n");
  const html = `<p>${escapeHtml(greeting)}</p>
<p>У вас есть <strong>непрочитанные сообщения</strong> от поддержки в личном чате на сайте.</p>
<p><a href="${escapeHtmlAttr(openChatUrl)}">Открыть чат</a></p>
<p style="color:#64748b;font-size:14px;">Отключить уведомления: Настройки → «Уведомления на почту».</p>`;
  await sendTransactionalMail({ to, subject, text, html });
}

/** Акция стала доступна на сайте. */
export async function sendRaffleLaunchedEmail(
  to: string,
  name: string,
  raffleTitle: string,
  raffleUrl: string,
): Promise<void> {
  const subject = `Новая акция: ${raffleTitle}`;
  const greeting = name.trim() ? `Здравствуйте, ${name.trim()}!` : "Здравствуйте!";
  const text = [
    greeting,
    "",
    "На сайте запущена акция:",
    raffleTitle,
    "",
    "Подробности и участие:",
    raffleUrl,
    "",
    "Отключить рассылку о новых акциях можно в «Настройки» → «Уведомления на почту».",
  ].join("\n");
  const html = `<p>${escapeHtml(greeting)}</p>
<p>На сайте запущена акция:</p>
<p><strong>${escapeHtml(raffleTitle)}</strong></p>
<p><a href="${escapeHtmlAttr(raffleUrl)}">Открыть страницу акции</a></p>
<p style="color:#64748b;font-size:14px;">Отключить уведомления о новых акциях: Настройки → «Уведомления на почту».</p>`;
  await sendTransactionalMail({ to, subject, text, html });
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
