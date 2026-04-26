import { randomBytes } from "node:crypto";
import {
  getUserByEmail,
  hashPasswordResetToken,
  PASSWORD_RESET_TTL_MS,
  setPasswordResetTokenForUser,
} from "../../../../lib/auth-sqlite";
import { isSmtpReady, sendPasswordResetEmail } from "../../../../../server/mail";

function publicAppOrigin(): string {
  const u = process.env.APP_PUBLIC_URL?.trim() || process.env.SITE_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://127.0.0.1:3000";
}

export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Введите корректный email" }, { status: 400 });
  }
  const generic = { ok: true, message: "Если email найден, мы отправим ссылку" };
  const user = await getUserByEmail(email);
  if (!user) {
    return Response.json(generic);
  }
  if (!isSmtpReady()) {
    console.warn("[auth/forgot] SMTP не настроен (SMTP_HOST, SMTP_USER, SMTP_PASS) — письмо не отправлено");
    return Response.json(generic);
  }
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashPasswordResetToken(rawToken);
  const expiresAt = Date.now() + PASSWORD_RESET_TTL_MS;
  await setPasswordResetTokenForUser(user.id, tokenHash, expiresAt);
  const resetUrl = `${publicAppOrigin()}/home/reset-password?token=${encodeURIComponent(rawToken)}`;
  try {
    await sendPasswordResetEmail(email, resetUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auth/forgot] SMTP failed:", msg);
    return Response.json({ error: "Не удалось отправить письмо. Попробуйте позже." }, { status: 500 });
  }
  return Response.json(generic);
}
