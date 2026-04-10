import nodemailer from "nodemailer";

function smtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = String(process.env.SMTP_PASS ?? "").trim();
  return Boolean(host && user && pass);
}

export function isSmtpReady(): boolean {
  return smtpConfigured();
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  if (!smtpConfigured()) {
    throw new Error("SMTP не настроен (SMTP_HOST, SMTP_USER, SMTP_PASS)");
  }
  const host = String(process.env.SMTP_HOST).trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER).trim();
  const pass = String(process.env.SMTP_PASS);
  /* Mail.ru и др.: «От» должен совпадать с SMTP_USER или быть явно задан в SMTP_FROM */
  const from = process.env.SMTP_FROM?.trim() || user;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    ...(port === 587 ? { requireTLS: true } : {}),
  });

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

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
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
