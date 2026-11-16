import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 5;
const TTL_SEC = 10 * 60;
const USED_MAX = 20_000;

const usedCaptchaIds = new Map<string, number>();

function signingSecret(): string {
  const s =
    process.env.CAPTCHA_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    process.env.UPLOAD_SIGNING_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.AB_INTERNAL_SECRET?.trim() ||
    "";
  return s || "ab-dev-captcha-signing-change-me";
}

function cleanupUsed(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [id, exp] of usedCaptchaIds) {
    if (exp < now) usedCaptchaIds.delete(id);
  }
  if (usedCaptchaIds.size <= USED_MAX) return;
  const drop = usedCaptchaIds.size - USED_MAX;
  let i = 0;
  for (const id of usedCaptchaIds.keys()) {
    usedCaptchaIds.delete(id);
    if (++i >= drop) break;
  }
}

function randInt(max: number): number {
  return randomBytes(2).readUInt16BE(0) % max;
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[randInt(ALPHABET.length)]!;
  }
  return out;
}

function answerHash(code: string): string {
  return createHash("sha256")
    .update(`${signingSecret()}:captcha:${code.toUpperCase()}`, "utf8")
    .digest("hex");
}

function hmacHex(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildCaptchaSvg(code: string): string {
  const w = 180;
  const h = 56;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Капча">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="#f4f1ea"/>`);
  for (let i = 0; i < 8; i++) {
    const x1 = randInt(w);
    const y1 = randInt(h);
    const x2 = randInt(w);
    const y2 = randInt(h);
    const op = (25 + randInt(35)) / 100;
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#6b7280" stroke-width="1" opacity="${op}"/>`,
    );
  }
  for (let i = 0; i < 18; i++) {
    const cx = randInt(w);
    const cy = randInt(h);
    const r = 1 + randInt(2);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#9ca3af" opacity="0.45"/>`);
  }
  const chars = code.split("");
  chars.forEach((ch, idx) => {
    const x = 18 + idx * 32 + randInt(6);
    const y = 34 + randInt(8);
    const rot = -28 + randInt(56);
    const size = 22 + randInt(6);
    const fill = idx % 2 === 0 ? "#1f2937" : "#374151";
    parts.push(
      `<text x="${x}" y="${y}" fill="${fill}" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="700" transform="rotate(${rot} ${x} ${y})">${escapeXml(ch)}</text>`,
    );
  });
  parts.push("</svg>");
  return parts.join("");
}

export type RegisterCaptchaChallenge = {
  captcha_token: string;
  image_svg: string;
  expires_in_sec: number;
};

export function createRegisterCaptcha(): RegisterCaptchaChallenge {
  cleanupUsed();
  const code = randomCode();
  const id = randomBytes(16).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  const ah = answerHash(code);
  const payload = `${id}.${exp}.${ah}`;
  const sig = hmacHex(payload);
  const captcha_token = `${payload}.${sig}`;
  return {
    captcha_token,
    image_svg: buildCaptchaSvg(code),
    expires_in_sec: TTL_SEC,
  };
}

export function verifyRegisterCaptcha(
  tokenRaw: string | null | undefined,
  answerRaw: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  cleanupUsed();
  const token = String(tokenRaw || "").trim();
  const answer = String(answerRaw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!token || !answer) {
    return { ok: false, error: "Введите код с картинки" };
  }
  if (answer.length < 4 || answer.length > 8) {
    return { ok: false, error: "Неверный код с картинки" };
  }
  const parts = token.split(".");
  if (parts.length !== 4) {
    return { ok: false, error: "Обновите капчу и попробуйте снова" };
  }
  const [id, expStr, ah, sig] = parts as [string, string, string, string];
  if (!/^[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(ah) || !/^[a-f0-9]{64}$/.test(sig)) {
    return { ok: false, error: "Обновите капчу и попробуйте снова" };
  }
  const exp = Math.floor(Number(expStr));
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, error: "Капча устарела — обновите код" };
  }
  const payload = `${id}.${exp}.${ah}`;
  const expectedSig = hmacHex(payload);
  if (!safeEqualHex(sig, expectedSig)) {
    return { ok: false, error: "Обновите капчу и попробуйте снова" };
  }
  if (usedCaptchaIds.has(id)) {
    return { ok: false, error: "Капча уже использована — обновите код" };
  }
  const expectedAnswer = answerHash(answer);
  if (!safeEqualHex(ah, expectedAnswer)) {
    return { ok: false, error: "Неверный код с картинки" };
  }
  usedCaptchaIds.set(id, exp);
  return { ok: true };
}
