import bcrypt from "bcryptjs";
import { consumePasswordResetToken, hashPasswordResetToken, updateUserPasswordHash } from "../../../../lib/auth-sqlite";

export async function POST(request: Request) {
  let body: { token?: string; password?: string };
  try {
    body = (await request.json()) as { token?: string; password?: string };
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  const raw = String(body.token ?? "").trim();
  const password = String(body.password ?? "");
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    return Response.json({ error: "Некорректная ссылка" }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json({ error: "Пароль не короче 6 символов" }, { status: 400 });
  }
  const tokenHash = hashPasswordResetToken(raw);
  const userId = await consumePasswordResetToken(tokenHash);
  if (!userId) {
    return Response.json({ error: "Ссылка недействительна или истекла" }, { status: 400 });
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  await updateUserPasswordHash(userId, passwordHash);
  return Response.json({ ok: true });
}
