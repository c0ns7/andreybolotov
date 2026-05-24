import "./load-env";
import { createServer } from "node:http";
import { mkdirSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  getSupportMessageById,
  insertSupportMessage,
  listLatestSupportMessagesForUser,
  listSupportMessagesForUserBeforeId,
  listSupportMessagesForUser,
  markThreadReadByStaff,
  markStaffMessagesReadByUser,
  countUnreadStaffMessagesForUser,
  messageToDto,
  updateUserProfile,
  getRaffleById,
  getLatestVisibleActiveRaffle,
  listRafflesPublic,
  isRaffleVisibleOnSite,
  raffleToDto,
  getSiteSettings,
} from "./db.js";
import {
  createSessionPg,
  deleteSessionPg,
  getUserByEmailPg,
  getUserByIdPg,
  getUserByPhonePg,
  getUserBySessionTokenPg,
  insertUserPg,
  setPasswordResetTokenForUserPg,
  consumePasswordResetTokenPg,
  PASSWORD_RESET_TTL_MS_PG,
  touchUserLastActivePg,
  updateUserEmailNotifyPrefsPg,
  updateUserLocalityPg,
  updateUserPasswordHashPg,
} from "./db-auth-pg.js";
import { attachWebSocket, broadcastRaffleGridUpdated, broadcastTypingUserToAdmins } from "./ws-chat.js";
import { getStaffTypingForUser } from "./typing-state.js";
import type { Context } from "hono";
import type { RaffleRow, SessionUser } from "./db.js";
import { isValidRuMobile, normalizePhone } from "./phone.js";
import { extForChatMime, parseChatAttachmentFromMessage } from "./chat-attachments.js";
import {
  attachReceiptToOrder,
  createReservation,
  getActiveOrderForUser,
  getOrderByIdForUser,
  getTicketGridSlice,
  getTicketNumbersForOrder,
  userCancelReservedRaffleOrder,
  addTicketsToReservedOrder,
  appendRandomTicketsToReservedOrder,
  getTicketCellKind,
  listConfirmedTicketGroupsForUser,
  listParticipationHistoryForUser,
  listPendingReviewTicketGroupsForUser,
  listReservedOrdersForUser,
  clearAllUserReservedCartItems,
  orderToDto,
  getPublicOrderStatusByToken,
  removeTicketFromReservedOrder,
  setOrderBank,
  materializeRafflePreassignmentsForUser,
  isRaffleTicketBlocked,
  getRaffleOccupiedCount,
  listWholesaleSlotsForUser,
  buildRafflePaymentParticipationContext,
  listGloballyFreeTicketNumbers,
} from "./raffle-orders.js";
import { sendPasswordResetEmail, isSmtpReady } from "./mail.js";
import { tickReserveExpiryEmailReminders, warnIfNoSmtpOnce } from "./notify-email.js";
import { getPublicSiteMusicPayload } from "./site-music.js";
import {
  startRaffleFreeTicketsPushInterval,
  tickRaffleFreeTicketsPushReminders,
} from "./raffle-free-tickets-push.js";
import { adminSubApp } from "./admin-subapp.js";

const PORT = Number(process.env.PORT) || 3000;

function notifyRaffleGridMutated(raffleId: number | undefined | null): void {
  const r = Math.floor(Number(raffleId));
  if (Number.isFinite(r) && r > 0) broadcastRaffleGridUpdated(r);
}

/** Ссылка-приглашение в приватный чат Андрея Болотова в MAX (показывается в авто-сообщении после утверждения чека). */
const MAX_PRIVATE_CHAT_JOIN_URL =
  "https://max.ru/join/_vIVZ3_FIwNimrGLFBwVEDWR408uZ3uynFc336CYX2k";

function buildStaffRaffleReceiptConfirmedChatBody(
  raffleTitle: string,
  paidTicketNumbers: number[],
  bonusTicketNumbers: number[],
  bonusPromoLabel: "5+1" | "5+2" = "5+1",
): string {
  const paidUniq = [
    ...new Set(paidTicketNumbers.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0)),
  ];
  paidUniq.sort((a, b) => a - b);
  const bonusUniq = [
    ...new Set(
      bonusTicketNumbers.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
  bonusUniq.sort((a, b) => a - b);
  const paidHuman = paidUniq.length ? paidUniq.map((n) => `№${n}`).join(", ") : "—";
  const bonusHuman = bonusUniq.length ? bonusUniq.map((n) => `№${n}`).join(", ") : "—";
  const safeTitle = String(raffleTitle || "акция")
    .trim()
    .slice(0, 180);
  const bonusBlock = bonusUniq.length
    ? `\n\n🎁 По акции ${bonusPromoLabel} дополнительно закреплены бонусные номерки: ${bonusHuman}.`
    : "";
  return (
    `Поздравляем! Чек по акции «${safeTitle}» закреплён.\n` +
    `Оплаченные номерки: ${paidHuman}.` +
    bonusBlock +
    `\n\n` +
    `Если вас ещё нет в нашем приватном чате в MAX, вы можете присоединиться по кнопке ниже.\n` +
    MAX_PRIVATE_CHAT_JOIN_URL
  );
}

/** Только приглашение в MAX (без текста про закрепление номерков) — массовая рассылка в чат. */
function buildStaffMaxPrivateInviteOnlyChatBody(): string {
  return (
    `Если вас ещё нет в нашем приватном чате в MAX, вы можете присоединиться по кнопке ниже.\n` +
    MAX_PRIVATE_CHAT_JOIN_URL
  );
}

const RAFFLE_VIEW_TTL_MS = 70_000;
const raffleViewersByRaffle = new Map<number, Map<number, number>>();

function cleanupRaffleViewers(nowTs: number): void {
  for (const [raffleId, users] of raffleViewersByRaffle) {
    for (const [userId, ts] of users) {
      if (nowTs - ts > RAFFLE_VIEW_TTL_MS) users.delete(userId);
    }
    if (users.size === 0) raffleViewersByRaffle.delete(raffleId);
  }
}

function touchRaffleViewer(raffleId: number, userId: number): void {
  const now = Date.now();
  cleanupRaffleViewers(now);
  let users = raffleViewersByRaffle.get(raffleId);
  if (!users) {
    users = new Map<number, number>();
    raffleViewersByRaffle.set(raffleId, users);
  }
  users.set(userId, now);
}

function getRaffleViewerCount(raffleId: number): number {
  const now = Date.now();
  cleanupRaffleViewers(now);
  const users = raffleViewersByRaffle.get(raffleId);
  return users ? users.size : 0;
}

function publicAppOrigin(): string {
  const u = process.env.APP_PUBLIC_URL?.trim() || process.env.SITE_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://127.0.0.1:4321";
}

function hashPasswordResetToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const envUploadsRoot = (process.env.UPLOADS_ROOT || "").trim();
const uploadsRoots = (() => {
  if (envUploadsRoot) {
    return [path.isAbsolute(envUploadsRoot) ? envUploadsRoot : path.join(projectRoot, envUploadsRoot)];
  }
  const roots = [path.join(projectRoot, "public", "uploads")];
  const distUploads = path.join(projectRoot, "dist", "uploads");
  if (existsSync(path.join(projectRoot, "dist")) && !roots.includes(distUploads)) {
    roots.push(distUploads);
  }
  return roots;
})();

function ensureUploadDirs(subdir: string): string[] {
  const dirs = uploadsRoots.map((root) => path.join(root, subdir));
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  return dirs;
}

async function writeUploadToDirs(dirs: string[], fileName: string, buffer: Buffer): Promise<void> {
  await Promise.all(
    dirs.map(async (dir) => {
      const filePath = path.join(dir, fileName);
      await writeFile(filePath, buffer);
    }),
  );
}

const raffleUploadsDirs = ensureUploadDirs("raffles");
const chatUploadsDirs = ensureUploadDirs("chat");
const receiptUploadsDirs = ensureUploadDirs("receipts");

function parseChatMessagePayload(body: { body?: string; attachment?: unknown }):
  | { ok: true; text: string; attachment: ReturnType<typeof parseChatAttachmentFromMessage> }
  | { ok: false; error: string } {
  const text = String(body.body ?? "").trim();
  const att = parseChatAttachmentFromMessage(body.attachment);
  const hasAttField = body.attachment !== undefined && body.attachment !== null;
  if (hasAttField && !att) return { ok: false, error: "Некорректное вложение" };
  if (!text && !att) return { ok: false, error: "Введите сообщение или прикрепите файл" };
  if (text.length > 4000) return { ok: false, error: "Сообщение слишком длинное" };
  return { ok: true, text, attachment: att };
}

async function handleChatFileUpload(c: Context): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "Некорректные данные" }, 400);
  }
  const raw = body["file"];
  if (!raw || typeof raw !== "object") {
    return c.json({ error: "Нет файла" }, 400);
  }
  const blob = raw as { type?: string; arrayBuffer?: () => Promise<ArrayBuffer>; name?: string };
  if (typeof blob.arrayBuffer !== "function") {
    return c.json({ error: "Некорректный файл" }, 400);
  }
  const ab = await blob.arrayBuffer();
  const buffer = Buffer.from(ab);
  if (buffer.length > 10 * 1024 * 1024) {
    return c.json({ error: "Файл не больше 10 МБ" }, 400);
  }
  const mime = String(blob.type || "application/octet-stream").toLowerCase().split(";")[0].trim();
  const ext = extForChatMime(mime);
  if (!ext) {
    return c.json({ error: "Тип файла не поддерживается" }, 400);
  }
  const fileName = `${randomUUID()}${ext}`;
  await writeUploadToDirs(chatUploadsDirs, fileName, buffer);
  const url = `/uploads/chat/${fileName}`;
  const origName = String(blob.name || "file")
    .replace(/[<>\"]/g, "")
    .slice(0, 255);
  return c.json({ url, name: origName || "файл", mime });
}

function extForReceiptMime(mime: string): string | null {
  const ext = extForChatMime(mime.toLowerCase().split(";")[0].trim());
  if (!ext) return null;
  if (ext === ".jpg" || ext === ".png" || ext === ".webp" || ext === ".gif" || ext === ".pdf") {
    return ext;
  }
  return null;
}

async function handleReceiptFileUpload(c: Context): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "Некорректные данные" }, 400);
  }
  const raw = body["file"];
  if (!raw || typeof raw !== "object") {
    return c.json({ error: "Нет файла" }, 400);
  }
  const blob = raw as { type?: string; arrayBuffer?: () => Promise<ArrayBuffer>; name?: string };
  if (typeof blob.arrayBuffer !== "function") {
    return c.json({ error: "Некорректный файл" }, 400);
  }
  const ab = await blob.arrayBuffer();
  const buffer = Buffer.from(ab);
  if (buffer.length > 10 * 1024 * 1024) {
    return c.json({ error: "Файл не больше 10 МБ" }, 400);
  }
  const mime = String(blob.type || "application/octet-stream").toLowerCase().split(";")[0].trim();
  const ext = extForReceiptMime(mime);
  if (!ext) {
    return c.json({ error: "Допустимы изображения или PDF" }, 400);
  }
  const fileName = `${randomUUID()}${ext}`;
  await writeUploadToDirs(receiptUploadsDirs, fileName, buffer);
  const url = `/uploads/receipts/${fileName}`;
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const origName = String(blob.name || "чек")
    .replace(/[<>\"]/g, "")
    .slice(0, 255);
  return c.json({ url, name: origName || "чек", mime, sha256 });
}

const app = new Hono();

async function readStaticAsset(assetName: string): Promise<Buffer | null> {
  const safe = String(assetName || "").replace(/^\/+/, "").replace(/\\/g, "/");
  if (!safe || safe.includes("..")) return null;
  const roots = [
    path.join(process.cwd(), "next-app", "public"),
    path.join(process.cwd(), "public"),
    path.join(projectRoot, "next-app", "public"),
    path.join(projectRoot, "public"),
    path.join(projectRoot, "..", "next-app", "public"),
    path.join(projectRoot, "..", "public"),
  ];
  for (const root of roots) {
    const rootAbs = path.resolve(root);
    const full = path.resolve(rootAbs, safe);
    if (!full.startsWith(rootAbs)) continue;
    if (!existsSync(full)) continue;
    try {
      return await readFile(full);
    } catch {
      /* ignore and fallback */
    }
  }
  return null;
}

function staticMime(assetName: string): string {
  const n = String(assetName || "").toLowerCase();
  if (n.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

async function serveStaticAsset(c: Context, assetName: string): Promise<Response> {
  const buf = await readStaticAsset(assetName);
  if (!buf) return c.json({ error: "Not Found", asset: assetName }, 404);
  c.header("Content-Type", staticMime(assetName));
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(buf);
}

app.get("/favicon.svg", async (c) => serveStaticAsset(c, "favicon.svg"));
app.get("/favicon.ico", async (c) => {
  const svg = await readStaticAsset("favicon.svg");
  if (svg) {
    c.header("Content-Type", "image/svg+xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(svg);
  }
  return c.redirect("/favicon.svg");
});
app.get("/logo-ab.svg", async (c) => c.redirect("/logoandreybolotov.png"));
app.get("/logoandreybolotov.png", async (c) => serveStaticAsset(c, "logoandreybolotov.png"));
app.get("/logo.png", async (c) => {
  const png = await readStaticAsset("logoandreybolotov.png");
  if (png) {
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(png);
  }
  return c.redirect("/logoandreybolotov.png");
});
app.get("/og-cover.svg", async (c) => serveStaticAsset(c, "og-cover.svg"));
app.get("/dice.svg", async (c) => serveStaticAsset(c, "dice.svg"));
app.get("/dice.png", async (c) => c.redirect("/dice.svg"));
app.get("/img/*", async (c) => {
  const reqPath = c.req.path.replace(/^\/+/, "");
  return serveStaticAsset(c, reqPath);
});

app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

function maintenanceBypassPath(path: string): boolean {
  if (path === "/api/health" || path === "/api/site/status" || path === "/api/site/music") return true;
  return (
    path === "/api/auth/register" ||
    path === "/api/auth/check-phone" ||
    path === "/api/auth/login" ||
    path === "/api/auth/me" ||
    path === "/api/auth/change-password" ||
    path === "/api/auth/email-notifications" ||
    path === "/api/auth/logout" ||
    path === "/api/auth/forgot" ||
    path === "/api/auth/reset-password"
  );
}

app.use(async (c, next) => {
  const p = c.req.path;
  if (!p.startsWith("/api/")) return next();
  if (maintenanceBypassPath(p)) return next();
  const site = await getSiteSettings();
  if (!site.maintenance_enabled) return next();
  const u = await authUser(c);
  if (u && u.role === "admin") return next();
  return c.json(
    { error: "Технические работы. Попробуйте позже.", code: "maintenance" },
    503,
  );
});

app.get("/api/health", (c) =>
  c.json({ ok: true, service: "andreybolotov-api", ts: Date.now() }),
);

app.get("/api/site/status", async (c) => {
  c.header("Cache-Control", "no-store");
  const site = await getSiteSettings();
  return c.json({
    maintenance: site.maintenance_enabled,
    blog_enabled: site.blog_enabled,
    music_enabled: site.music_enabled,
  });
});

app.get("/api/site/music", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await getPublicSiteMusicPayload());
});

async function authUser(c: Context): Promise<SessionUser | null> {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return (await getUserBySessionTokenPg(token)) ?? null;
}

function isBlockedUser(u: SessionUser): boolean {
  return Number(u.blocked) === 1;
}

async function requireUser(c: Context): Promise<SessionUser | Response> {
  const u = await authUser(c);
  if (!u) return c.json({ error: "Не авторизован" }, 401);
  if (isBlockedUser(u)) {
    return c.json({ error: "Аккаунт заблокирован", code: "account_blocked" }, 403);
  }
  await touchUserLastActivePg(u.id);
  return u;
}

const rateLimitBuckets = new Map<string, { win: number; n: number }>();

function rateLimitAllow(key: string, max: number, windowMs: number): boolean {
  if (process.env.AB_ENABLE_RATE_LIMIT !== "1") return true;
  const now = Date.now();
  let b = rateLimitBuckets.get(key);
  if (!b || now - b.win > windowMs) {
    b = { win: now, n: 0 };
    rateLimitBuckets.set(key, b);
  }
  b.n += 1;
  return b.n <= max;
}

function rateLimitExceeded(c: Context) {
  return c.json({ error: "Слишком много запросов. Подождите немного." }, 429);
}

/** Акция на сайте или есть незавершённая заявка пользователя (бронь / проверка чека). */
async function raffleVisibleOrActiveOrder(c: Context, u: SessionUser, id: number): Promise<RaffleRow | Response> {
  const raffle = await getRaffleById(id);
  if (!raffle) return c.json({ error: "Не найдено" }, 404);
  if (isRaffleVisibleOnSite(raffle)) return raffle;
  const order = await getActiveOrderForUser(id, u.id);
  if (order) return raffle;
  return c.json({ error: "Не найдено" }, 404);
}

app.get("/api/public/raffle-order-status", async (c) => {
  const ip = String(c.req.header("x-forwarded-for") ?? "")
    .split(",")[0]
    .trim();
  const keyIp = ip || c.req.header("x-real-ip") || "local";
  if (!rateLimitAllow(`get:pub-order:${keyIp}`, 45, 60_000)) return rateLimitExceeded(c);
  c.header("Cache-Control", "no-store");
  const t = String(c.req.query("t") ?? "").trim();
  const dto = await getPublicOrderStatusByToken(t);
  if (!dto) return c.json({ found: false });
  return c.json(dto);
});

/** Публично: последняя видимая активная акция и полный список свободных номерков (для /numbers). */
app.get("/api/public/latest-raffle/free-numbers", async (c) => {
  const ip = String(c.req.header("x-forwarded-for") ?? "")
    .split(",")[0]
    .trim();
  const keyIp = ip || c.req.header("x-real-ip") || "local";
  if (!rateLimitAllow(`get:pub-free-nums:${keyIp}`, 30, 60_000)) return rateLimitExceeded(c);
  c.header("Cache-Control", "no-store");
  const row = await getLatestVisibleActiveRaffle();
  if (!row) {
    return c.json({
      raffle: null,
      raffle_id: null,
      ticket_count: 0,
      free_numbers: [],
      free_count: 0,
      server_time_ms: Date.now(),
    });
  }
  const free = await listGloballyFreeTicketNumbers(row.id);
  return c.json({
    raffle: raffleToDto(row),
    raffle_id: row.id,
    ticket_count: row.ticket_count,
    free_numbers: free,
    free_count: free.length,
    server_time_ms: Date.now(),
  });
});

app.get("/api/internal/cron/raffle-mail-tick", async (c) => {
  const want = process.env.CRON_SECRET?.trim();
  const got = String(c.req.query("secret") ?? "").trim();
  if (!want || got !== want) return c.json({ error: "Forbidden" }, 403);
  await tickReserveExpiryEmailReminders();
  return c.json({ ok: true, at: Date.now() });
});

app.get("/api/internal/cron/raffle-free-tickets-push-tick", async (c) => {
  const want = process.env.CRON_SECRET?.trim();
  const got = String(c.req.query("secret") ?? "").trim();
  if (!want || got !== want) return c.json({ error: "Forbidden" }, 403);
  const result = await tickRaffleFreeTicketsPushReminders();
  return c.json({ ok: true, at: Date.now(), ...result });
});

app.post("/api/auth/register", async (c) => {
  let body: { phone?: string; name?: string; locality?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const phone = normalizePhone(String(body.phone ?? ""));
  const name = String(body.name ?? "").trim();
  const locality = String(body.locality ?? "").trim().slice(0, 120);
  const password = String(body.password ?? "");

  if (!phone) return c.json({ error: "Введите полный номер телефона" }, 400);
  if (!isValidRuMobile(phone)) {
    return c.json({ error: "Нужен мобильный номер России (+7 9XX …)" }, 400);
  }
  if (!name) return c.json({ error: "Укажите ФИО" }, 400);
  if (!locality) return c.json({ error: "Укажите населенный пункт" }, 400);
  if (password.length < 6) return c.json({ error: "Пароль не короче 6 символов" }, 400);

  if (await getUserByPhonePg(phone)) {
    return c.json({ error: "Этот номер телефона уже зарегистрирован" }, 409);
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = await insertUserPg(phone, name, null, locality, passwordHash);
  try {
    const affected = await materializeRafflePreassignmentsForUser(userId);
    for (const rid of affected) notifyRaffleGridMutated(rid);
  } catch (e) {
    console.error("[register] materialize preassign:", e instanceof Error ? e.message : e);
  }
  const row = await getUserByIdPg(userId);
  const token = randomUUID();
  await createSessionPg(token, userId);
  return c.json({
    token,
    user: {
      id: userId,
      phone,
      name,
      locality: row?.locality != null ? String(row.locality).trim() : "",
      role: row?.role ?? "user",
      blocked: false,
    },
  });
});

app.post("/api/auth/check-phone", async (c) => {
  let body: { phone?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const phone = normalizePhone(String(body.phone ?? ""));
  if (!phone) return c.json({ error: "Введите полный номер телефона" }, 400);
  if (!isValidRuMobile(phone)) {
    return c.json({ error: "Нужен мобильный номер России (+7 9XX …)" }, 400);
  }
  const user = await getUserByPhonePg(phone);
  if (!user) return c.json({ exists: false });
  return c.json({
    exists: true,
    blocked: Number(user.blocked) === 1,
    name: String(user.name || ""),
  });
});

app.post("/api/auth/login", async (c) => {
  let body: { phone?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const phone = normalizePhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");

  if (!phone) return c.json({ error: "Введите полный номер телефона" }, 400);
  if (!isValidRuMobile(phone)) {
    return c.json({ error: "Нужен мобильный номер России (+7 9XX …)" }, 400);
  }
  if (!password) return c.json({ error: "Введите пароль" }, 400);

  const user = await getUserByPhonePg(phone);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ error: "Неверный телефон или пароль" }, 401);
  }
  if (Number(user.blocked) === 1) {
    return c.json(
      { error: "Аккаунт заблокирован. Обратитесь в поддержку.", code: "account_blocked" },
      403,
    );
  }

  const token = randomUUID();
  await createSessionPg(token, user.id);
  try {
    const affected = await materializeRafflePreassignmentsForUser(user.id);
    for (const rid of affected) notifyRaffleGridMutated(rid);
  } catch (e) {
    console.error("[login] materialize preassign:", e instanceof Error ? e.message : e);
  }

  return c.json({
    token,
    user: {
      id: user.id,
      phone: user.phone,
      name: user.name,
      locality: user.locality != null ? String(user.locality).trim() : "",
      role: user.role ?? "user",
      blocked: Number(user.blocked) === 1,
    },
  });
});

app.get("/api/auth/me", async (c) => {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return c.json({ error: "Не авторизован" }, 401);
  const user = await getUserBySessionTokenPg(token);
  if (!user) return c.json({ error: "Не авторизован" }, 401);
  try {
    const affected = await materializeRafflePreassignmentsForUser(user.id);
    for (const rid of affected) notifyRaffleGridMutated(rid);
  } catch (e) {
    console.error("[me] materialize preassign:", e instanceof Error ? e.message : e);
  }
  const row = await getUserByIdPg(user.id);
  return c.json({
    user: {
      id: user.id,
      phone: user.phone,
      name: user.name,
      locality: row?.locality != null ? String(row.locality).trim() : "",
      role: user.role ?? "user",
      blocked: Number(user.blocked) === 1,
    },
  });
});

app.post("/api/auth/logout", async (c) => {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    const u = await getUserBySessionTokenPg(token);
    if (u && Number(u.blocked) === 1) {
      return c.json({ error: "Недоступно", code: "account_blocked" }, 403);
    }
    await deleteSessionPg(token);
  }
  return c.json({ ok: true });
});

app.post("/api/auth/forgot", async (c) => {
  return c.json(
    {
      error:
        "Сброс пароля по email отключён. Обратитесь к администратору в MAX: https://max.ru/u/f9LHodD0cOKSJihr4puAfiyfPGQJWImlRAdNuRhpYwI7qse5YaB625-1d3w",
    },
    410,
  );
});

app.post("/api/auth/reset-password", async (c) => {
  return c.json(
    {
      error:
        "Сброс пароля по ссылке отключён. Обратитесь к администратору в MAX: https://max.ru/u/f9LHodD0cOKSJihr4puAfiyfPGQJWImlRAdNuRhpYwI7qse5YaB625-1d3w",
    },
    410,
  );
});

app.post("/api/auth/change-password", async (c) => {
  const u = await requireUser(c);
  if (u instanceof Response) return u;
  let body: { current_password?: string; new_password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const current = String(body.current_password ?? "");
  const next = String(body.new_password ?? "");
  if (!current) return c.json({ error: "Введите текущий пароль" }, 400);
  if (next.length < 6) {
    return c.json({ error: "Новый пароль не короче 6 символов" }, 400);
  }
  if (next === current) {
    return c.json({ error: "Новый пароль должен отличаться от текущего" }, 400);
  }
  const row = await getUserByIdPg(u.id);
  if (!row || !bcrypt.compareSync(current, row.password_hash)) {
    return c.json({ error: "Неверный текущий пароль" }, 400);
  }
  await updateUserPasswordHashPg(u.id, bcrypt.hashSync(next, 10));
  return c.json({ ok: true });
});

app.patch("/api/auth/email-notifications", async (c) => {
  const u = await requireUser(c);
  if (u instanceof Response) return u;
  let body: {
    email_notify_chat?: unknown;
    email_notify_raffle_orders?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const patch: {
    email_notify_chat?: boolean;
    email_notify_raffle_orders?: boolean;
  } = {};
  if (typeof body.email_notify_chat === "boolean") patch.email_notify_chat = body.email_notify_chat;
  if (typeof body.email_notify_raffle_orders === "boolean") {
    patch.email_notify_raffle_orders = body.email_notify_raffle_orders;
  }
  if (
    patch.email_notify_chat === undefined &&
    patch.email_notify_raffle_orders === undefined
  ) {
    return c.json({ error: "Нет полей для сохранения" }, 400);
  }
  await updateUserEmailNotifyPrefsPg(u.id, patch);
  const row = await getUserByIdPg(u.id);
  return c.json({
    ok: true,
    email_notify_chat: row ? Number(row.email_notify_chat ?? 1) !== 0 : true,
    email_notify_raffles: false,
    email_notify_raffle_orders: row ? Number(row.email_notify_raffle_orders ?? 1) !== 0 : true,
  });
});

app.patch("/api/auth/locality", async (c) => {
  const u = await requireUser(c);
  if (u instanceof Response) return u;
  let body: { locality?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const locality = String(body.locality ?? "").trim().slice(0, 120);
  if (!locality) return c.json({ error: "Укажите населенный пункт" }, 400);
  await updateUserLocalityPg(u.id, locality);
  return c.json({ ok: true, locality });
});

app.get("/api/chat/unread", async (c) => {
  const u = await requireUser(c);
  if (u instanceof Response) return u;
  c.header("Cache-Control", "private, no-store");
  return c.json({ unread_staff: await countUnreadStaffMessagesForUser(u.id) });
});

app.post("/api/chat/mark-staff-read", async (c) => {
  const u = await requireUser(c);
  if (u instanceof Response) return u;
  await markStaffMessagesReadByUser(u.id);
  c.header("Cache-Control", "private, no-store");
  return c.json({ ok: true, unread_staff: 0 });
});

app.get("/api/chat/messages", async (c) => {
  const u = await requireUser(c);
  if (u instanceof Response) return u;
  c.header("Cache-Control", "no-store");
  const qBefore = Number(c.req.query("before_id"));
  const qLimit = Number(c.req.query("limit"));
  const limit = Number.isFinite(qLimit) ? Math.max(1, Math.min(100, Math.floor(qLimit))) : 40;
  const rows = Number.isFinite(qBefore) && qBefore > 0
    ? await listSupportMessagesForUserBeforeId(u.id, qBefore, limit)
    : await listLatestSupportMessagesForUser(u.id, limit);
  const oldestId = rows[0]?.id ?? null;
  const hasMore = oldestId ? (await listSupportMessagesForUserBeforeId(u.id, oldestId, 1)).length > 0 : false;
  return c.json({
    messages: rows.map((r) => messageToDto(r)),
    staff_typing: getStaffTypingForUser(u.id),
    has_more: hasMore,
  });
});

app.post("/api/chat/typing", async (c) => {
  const u = await requireUser(c);
  if (u instanceof Response) return u;
  let body: { active?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  broadcastTypingUserToAdmins(u.id, Boolean(body.active));
  return c.json({ ok: true });
});

app.post("/api/chat/upload", async (c) => {
  const u = await requireUser(c);
  if (u instanceof Response) return u;
  return handleChatFileUpload(c);
});

app.route("/", adminSubApp);

const server = createServer(getRequestListener(app.fetch));
const wss = new WebSocketServer({ noServer: true });
attachWebSocket(wss);

server.on("upgrade", (request, socket, head) => {
  const host = request.headers.host ?? "127.0.0.1";
  try {
    const u = new URL(request.url ?? "/", `http://${host}`);
    if (u.pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  } catch {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  warnIfNoSmtpOnce();
  console.log(`HTTP + WebSocket ws://127.0.0.1:${PORT}/ws`);
  console.log(`Database: PostgreSQL (DATABASE_URL)`);
  if (String(process.env.DISABLE_RAFFLE_MAIL_INTERVAL ?? "").trim() !== "1") {
    void tickReserveExpiryEmailReminders();
    setInterval(() => void tickReserveExpiryEmailReminders(), 60_000);
  } else {
    console.log("[mail] INTERVAL отключён — используйте CRON → GET /api/internal/cron/raffle-mail-tick?secret=…");
  }
  if (String(process.env.DISABLE_RAFFLE_FREE_TICKETS_PUSH_INTERVAL ?? "").trim() !== "1") {
    startRaffleFreeTicketsPushInterval();
    console.log("[push] Напоминания об остатке номерков: каждые 30 мин (остановка при < 25)");
  } else {
    console.log(
      "[push] Интервал остатка номерков отключён — CRON → GET /api/internal/cron/raffle-free-tickets-push-tick?secret=…",
    );
  }
});
