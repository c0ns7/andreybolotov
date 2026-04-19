import "./load-env.js";
import { createServer } from "node:http";
import { mkdirSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createSession,
  deleteSession,
  getSupportMessageById,
  getUserById,
  getUserByPhone,
  getUserByEmail,
  getUserBySessionToken,
  updateUserEmailNotifyPrefs,
  insertSupportMessage,
  insertUser,
  listAdminThreadsWithMeta,
  listSupportMessagesForUser,
  markThreadReadByStaff,
  markStaffMessagesReadByUser,
  countUnreadStaffMessagesForUser,
  messageToDto,
  updateUserProfile,
  updateUserPasswordHash,
  setPasswordResetTokenForUser,
  consumePasswordResetToken,
  PASSWORD_RESET_TTL_MS,
  insertRaffle,
  updateRaffle,
  deleteRaffle,
  getRaffleById,
  listRafflesAll,
  listRafflesPublic,
  isRaffleVisibleOnSite,
  raffleToDto,
  getSiteSettings,
  setMaintenanceEnabled,
  countActiveAdmins,
  listUsersForAdminPage,
  countUsersForAdmin,
  countUsersForAdminBySearch,
  updateUserRole,
  updateUserBlocked,
} from "./db.js";
import {
  attachWebSocket,
  broadcastChatMessage,
  broadcastRafflesFeedUpdated,
  broadcastRaffleGridUpdated,
  broadcastRaffleTicketsUpdated,
  broadcastThreadReadByStaff,
  broadcastTypingStaffToUser,
  broadcastTypingUserToAdmins,
} from "./ws-chat.js";
import { getStaffTypingForUser, getUserTypingForThread } from "./typing-state.js";
import type { Context } from "hono";
import type { RaffleRow, SessionUser } from "./db.js";
import { isValidRuMobile, normalizePhone } from "./phone.js";
import { extForChatMime, parseChatAttachmentFromMessage } from "./chat-attachments.js";
import {
  attachReceiptToOrder,
  confirmOrderByAdmin,
  createReservation,
  getActiveOrderForUser,
  getOrderById,
  getOrderByIdForUser,
  getTicketGridSlice,
  getTicketNumbersForOrder,
  listPendingPayments,
  adminFullyReleaseRaffleOrder,
  userCancelReservedRaffleOrder,
  listActiveOrdersForAdmin,
  getAdminRaffleParticipantsBundle,
  recalculateWholesaleForRaffle,
  addTicketsToReservedOrder,
  appendRandomTicketsToReservedOrder,
  getTicketCellKind,
  listConfirmedTicketGroupsForUser,
  listPendingReviewTicketGroupsForUser,
  listReservedOrdersForUser,
  clearAllUserReservedCartItems,
  orderToDto,
  rejectOrderByAdmin,
  getPublicOrderStatusByToken,
  removeTicketFromReservedOrder,
  setOrderBank,
  materializeRafflePreassignmentsForUser,
  adminBulkAssignPhoneLinesToRaffle,
  adminAssignPhoneToExactTicket,
  adminDetachParticipantTicket,
  isRaffleTicketBlocked,
  getRaffleOccupiedCount,
  listWholesaleSlotsForUser,
  adminUserTicketsForPrimaryRaffle,
  listUserIdsWithConfirmedRaffleOrders,
  buildRafflePaymentParticipationContext,
  listReceiptHistoryPriorForPendingOrder,
} from "./raffle-orders.js";
import { sendPasswordResetEmail, isSmtpReady } from "./mail.js";
import {
  maybeSendRaffleLaunchEmails,
  notifyUserEmailStaffReply,
  notifyUserReceiptRejectedRework,
  notifyUserOrderFullyReleased,
  tickReserveExpiryEmailReminders,
  warnIfNoSmtpOnce,
} from "./notify-email.js";

const PORT = Number(process.env.PORT) || 3000;

function notifyRaffleGridMutated(raffleId: number | undefined | null): void {
  const r = Math.floor(Number(raffleId));
  if (Number.isFinite(r) && r > 0) broadcastRaffleGridUpdated(r);
}

/** Ссылка-приглашение в приватный чат Андрея Болотова в MAX (показывается в авто-сообщении после утверждения чека). */
const MAX_PRIVATE_CHAT_JOIN_URL =
  "https://max.ru/join/_vIVZ3_FIwNimrGLFBwVEDWR408uZ3uynFc336CYX2k";

function buildStaffRaffleReceiptConfirmedChatBody(raffleTitle: string, ticketNumbers: number[]): string {
  const uniq = [
    ...new Set(ticketNumbers.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0)),
  ];
  uniq.sort((a, b) => a - b);
  const numsHuman = uniq.length ? uniq.map((n) => `№${n}`).join(", ") : "—";
  const safeTitle = String(raffleTitle || "акция")
    .trim()
    .slice(0, 180);
  return (
    `Поздравляем! Чек по акции «${safeTitle}» подтверждён — номерки закреплены за вами: ${numsHuman}.\n\n` +
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
  if (path === "/api/health" || path === "/api/site/status") return true;
  return (
    path === "/api/auth/register" ||
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
  if (!getSiteSettings().maintenance_enabled) return next();
  const u = authUser(c);
  if (u && u.role === "admin") return next();
  return c.json(
    { error: "Технические работы. Попробуйте позже.", code: "maintenance" },
    503,
  );
});

app.get("/api/health", (c) =>
  c.json({ ok: true, service: "andreybolotov-api", ts: Date.now() }),
);

app.get("/api/site/status", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({
    maintenance: getSiteSettings().maintenance_enabled,
  });
});

function authUser(c: Context): SessionUser | null {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return getUserBySessionToken(token) ?? null;
}

function isBlockedUser(u: SessionUser): boolean {
  return u.blocked === 1;
}

function requireUser(c: Context): SessionUser | Response {
  const u = authUser(c);
  if (!u) return c.json({ error: "Не авторизован" }, 401);
  if (isBlockedUser(u)) {
    return c.json({ error: "Аккаунт заблокирован", code: "account_blocked" }, 403);
  }
  return u;
}

function requireAdmin(c: Context): SessionUser | Response {
  const u = authUser(c);
  if (!u) return c.json({ error: "Не авторизован" }, 401);
  if (isBlockedUser(u)) {
    return c.json({ error: "Аккаунт заблокирован", code: "account_blocked" }, 403);
  }
  if (u.role !== "admin") return c.json({ error: "Недостаточно прав" }, 403);
  return u;
}

const rateLimitBuckets = new Map<string, { win: number; n: number }>();

function rateLimitAllow(key: string, max: number, windowMs: number): boolean {
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
function raffleVisibleOrActiveOrder(c: Context, u: SessionUser, id: number): RaffleRow | Response {
  const raffle = getRaffleById(id);
  if (!raffle) return c.json({ error: "Не найдено" }, 404);
  if (isRaffleVisibleOnSite(raffle)) return raffle;
  const order = getActiveOrderForUser(id, u.id);
  if (order) return raffle;
  return c.json({ error: "Не найдено" }, 404);
}

function normalizeRaffleStatus(s: string): "active" | "closed" | "paused" {
  if (s === "closed" || s === "paused") return s;
  return "active";
}

type RaffleInput = {
  title: string;
  cover_image_url: string;
  price_rub: number;
  old_price_rub: number;
  ticket_count: number;
  collection_url: string;
  tbank_collection_url: string;
  collection_recipient: string;
  sber_collection_recipient: string;
  tbank_collection_recipient: string;
  qr_image_url: string;
  qr_recipient: string;
  qr_payment_purpose: string;
  sber_enabled: boolean;
  tbank_enabled: boolean;
  qr_enabled: boolean;
  rules_url: string;
  status: "active" | "closed" | "paused";
  sort_order: number;
  wholesale_enabled: boolean;
  hidden_from_public: boolean;
};

function parseRaffleBody(body: Record<string, unknown>): { ok: true; value: RaffleInput } | { ok: false; error: string } {
  const title = String(body.title ?? "").trim();
  if (!title) return { ok: false, error: "Укажите заголовок" };
  if (title.length > 500) return { ok: false, error: "Заголовок слишком длинный" };

  const cover_image_url = String(body.cover_image_url ?? "").trim();
  const collection_url = String(body.collection_url ?? "").trim();
  const tbank_collection_url = String(body.tbank_collection_url ?? "").trim();
  const collection_recipient = String(body.collection_recipient ?? "").trim();
  const sber_collection_recipient = String(
    body.sber_collection_recipient ?? body.collection_recipient ?? "",
  ).trim();
  const tbank_collection_recipient = String(
    body.tbank_collection_recipient ?? body.collection_recipient ?? "",
  ).trim();
  const qr_image_url = String(body.qr_image_url ?? "").trim();
  const qr_recipient = String(body.qr_recipient ?? body.collection_recipient ?? "").trim();
  const qr_payment_purpose = String(body.qr_payment_purpose ?? "Оплата услуг")
    .trim()
    .slice(0, 200);
  const sber_enabled =
    body.sber_enabled === undefined ? Boolean(collection_url) : Boolean(body.sber_enabled);
  const tbank_enabled =
    body.tbank_enabled === undefined ? Boolean(tbank_collection_url) : Boolean(body.tbank_enabled);
  const qr_enabled = body.qr_enabled === undefined ? Boolean(qr_image_url) : Boolean(body.qr_enabled);

  const price_rub = Math.floor(Number(body.price_rub));
  const old_price_raw = body.old_price_rub;
  const old_price_rub =
    old_price_raw === undefined || old_price_raw === null || old_price_raw === ""
      ? 0
      : Math.floor(Number(old_price_raw));
  const ticket_count = Math.floor(Number(body.ticket_count));
  if (!Number.isFinite(price_rub) || price_rub < 0 || price_rub > 1_000_000_000) {
    return { ok: false, error: "Некорректная цена билета" };
  }
  if (!Number.isFinite(old_price_rub) || old_price_rub < 0 || old_price_rub > 1_000_000_000) {
    return { ok: false, error: "Некорректная старая цена" };
  }
  if (old_price_rub > 0 && old_price_rub <= price_rub) {
    return { ok: false, error: "Старая цена должна быть больше текущей (или оставьте пустой)" };
  }
  if (!Number.isFinite(ticket_count) || ticket_count < 0 || ticket_count > 100_000_000) {
    return { ok: false, error: "Некорректное количество номерков" };
  }

  const sort_order = Math.floor(Number(body.sort_order ?? 0));
  if (!Number.isFinite(sort_order)) {
    return { ok: false, error: "Некорректный порядок сортировки" };
  }

  const hasCollectionPayment =
    (sber_enabled && Boolean(collection_url)) || (tbank_enabled && Boolean(tbank_collection_url));
  const hasQrPayment = qr_enabled && Boolean(qr_image_url);
  const hasAnyPayment = hasCollectionPayment || hasQrPayment;
  const status = hasAnyPayment
    ? normalizeRaffleStatus(String(body.status ?? "active"))
    : "paused";

  const wholesale_enabled = Boolean(body.wholesale_enabled);
  const hidden_from_public = Boolean(body.hidden_from_public);

  let rules_url = String(body.rules_url ?? "").trim();
  if (rules_url.length > 2000) return { ok: false, error: "Ссылка на правила слишком длинная" };
  if (rules_url && !/^https?:\/\//i.test(rules_url)) {
    return { ok: false, error: "Правила акции: укажите URL с http:// или https://" };
  }

  return {
    ok: true,
    value: {
      title,
      cover_image_url,
      price_rub,
      old_price_rub,
      ticket_count,
      collection_url,
      tbank_collection_url,
      collection_recipient,
      sber_collection_recipient,
      tbank_collection_recipient,
      qr_image_url,
      qr_recipient,
      qr_payment_purpose: qr_payment_purpose || "Оплата услуг",
      sber_enabled,
      tbank_enabled,
      qr_enabled,
      rules_url,
      status,
      sort_order,
      wholesale_enabled,
      hidden_from_public,
    },
  };
}

app.get("/api/public/raffle-order-status", (c) => {
  const ip = String(c.req.header("x-forwarded-for") ?? "")
    .split(",")[0]
    .trim();
  const keyIp = ip || c.req.header("x-real-ip") || "local";
  if (!rateLimitAllow(`get:pub-order:${keyIp}`, 45, 60_000)) return rateLimitExceeded(c);
  c.header("Cache-Control", "no-store");
  const t = String(c.req.query("t") ?? "").trim();
  const dto = getPublicOrderStatusByToken(t);
  if (!dto) return c.json({ found: false });
  return c.json(dto);
});

app.get("/api/internal/cron/raffle-mail-tick", (c) => {
  const want = process.env.CRON_SECRET?.trim();
  const got = String(c.req.query("secret") ?? "").trim();
  if (!want || got !== want) return c.json({ error: "Forbidden" }, 403);
  tickReserveExpiryEmailReminders();
  return c.json({ ok: true, at: Date.now() });
});

app.post("/api/auth/register", async (c) => {
  let body: { phone?: string; name?: string; email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const phone = normalizePhone(String(body.phone ?? ""));
  const name = String(body.name ?? "").trim();
  const emailRaw = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!phone) return c.json({ error: "Введите полный номер телефона" }, 400);
  if (!isValidRuMobile(phone)) {
    return c.json({ error: "Нужен мобильный номер России (+7 9XX …)" }, 400);
  }
  if (!name) return c.json({ error: "Укажите ФИО" }, 400);
  let emailDb: string | null = null;
  if (emailRaw) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return c.json({ error: "Укажите корректный email" }, 400);
    }
    if (getUserByEmail(emailRaw)) {
      return c.json({ error: "Этот email уже зарегистрирован" }, 409);
    }
    emailDb = emailRaw;
  }
  if (password.length < 6) return c.json({ error: "Пароль не короче 6 символов" }, 400);

  if (getUserByPhone(phone)) {
    return c.json({ error: "Этот номер телефона уже зарегистрирован" }, 409);
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = insertUser(phone, name, emailDb, passwordHash);
  try {
    const affected = materializeRafflePreassignmentsForUser(userId);
    for (const rid of affected) notifyRaffleGridMutated(rid);
  } catch (e) {
    console.error("[register] materialize preassign:", e instanceof Error ? e.message : e);
  }
  const row = getUserById(userId);
  const token = randomUUID();
  createSession(token, userId);
  const emailOut = row?.email != null && String(row.email).trim() ? String(row.email).trim().toLowerCase() : "";
  return c.json({
    token,
    user: {
      phone,
      name,
      email: emailOut,
      role: row?.role ?? "user",
      blocked: false,
    },
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

  const user = getUserByPhone(phone);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ error: "Неверный телефон или пароль" }, 401);
  }
  if (user.blocked === 1) {
    return c.json(
      { error: "Аккаунт заблокирован. Обратитесь в поддержку.", code: "account_blocked" },
      403,
    );
  }

  const token = randomUUID();
  createSession(token, user.id);
  try {
    const affected = materializeRafflePreassignmentsForUser(user.id);
    for (const rid of affected) notifyRaffleGridMutated(rid);
  } catch (e) {
    console.error("[login] materialize preassign:", e instanceof Error ? e.message : e);
  }

  return c.json({
    token,
    user: {
      phone: user.phone,
      name: user.name,
      email: user.email != null && String(user.email).trim() ? String(user.email).trim().toLowerCase() : "",
      role: user.role ?? "user",
      blocked: user.blocked === 1,
    },
  });
});

app.get("/api/auth/me", (c) => {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return c.json({ error: "Не авторизован" }, 401);
  const user = getUserBySessionToken(token);
  if (!user) return c.json({ error: "Не авторизован" }, 401);
  try {
    const affected = materializeRafflePreassignmentsForUser(user.id);
    for (const rid of affected) notifyRaffleGridMutated(rid);
  } catch (e) {
    console.error("[me] materialize preassign:", e instanceof Error ? e.message : e);
  }
  const row = getUserById(user.id);
  const notifyChat = row ? Number(row.email_notify_chat ?? 1) !== 0 : true;
  const notifyRaffles = row ? Number(row.email_notify_raffles ?? 1) !== 0 : true;
  const notifyRaffleOrders = row ? Number(row.email_notify_raffle_orders ?? 1) !== 0 : true;
  return c.json({
    user: {
      phone: user.phone,
      name: user.name,
      email: user.email != null && String(user.email).trim() ? String(user.email).trim().toLowerCase() : "",
      role: user.role ?? "user",
      blocked: user.blocked === 1,
      email_notify_chat: notifyChat,
      email_notify_raffles: notifyRaffles,
      email_notify_raffle_orders: notifyRaffleOrders,
    },
  });
});

app.post("/api/auth/logout", (c) => {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    const u = getUserBySessionToken(token);
    if (u && u.blocked === 1) {
      return c.json({ error: "Недоступно", code: "account_blocked" }, 403);
    }
    deleteSession(token);
  }
  return c.json({ ok: true });
});

app.post("/api/auth/forgot", async (c) => {
  let body: { email?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Введите корректный email" }, 400);
  }
  const generic = { ok: true, message: "Если email найден, мы отправим ссылку" };
  const user = getUserByEmail(email);
  if (!user) {
    return c.json(generic);
  }
  if (!isSmtpReady()) {
    console.warn("[auth/forgot] SMTP не настроен (SMTP_HOST, SMTP_USER, SMTP_PASS) — письмо не отправлено");
    return c.json(generic);
  }
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashPasswordResetToken(rawToken);
  const expiresAt = Date.now() + PASSWORD_RESET_TTL_MS;
  setPasswordResetTokenForUser(user.id, tokenHash, expiresAt);
  const resetUrl = `${publicAppOrigin()}/home/reset-password?token=${encodeURIComponent(rawToken)}`;
  console.log("[auth/forgot] send reset email →", email);
  try {
    await sendPasswordResetEmail(email, resetUrl);
    console.log("[auth/forgot] reset email accepted by SMTP");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auth/forgot] SMTP failed:", msg);
    console.error(e);
    return c.json({ error: "Не удалось отправить письмо. Попробуйте позже." }, 500);
  }
  return c.json(generic);
});

app.post("/api/auth/reset-password", async (c) => {
  let body: { token?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const raw = String(body.token ?? "").trim();
  const password = String(body.password ?? "");
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    return c.json({ error: "Некорректная ссылка" }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: "Пароль не короче 6 символов" }, 400);
  }
  const tokenHash = hashPasswordResetToken(raw);
  const userId = consumePasswordResetToken(tokenHash);
  if (!userId) {
    return c.json({ error: "Ссылка недействительна или истекла" }, 400);
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  updateUserPasswordHash(userId, passwordHash);
  return c.json({ ok: true });
});

app.post("/api/auth/change-password", async (c) => {
  const u = requireUser(c);
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
  const row = getUserById(u.id);
  if (!row || !bcrypt.compareSync(current, row.password_hash)) {
    return c.json({ error: "Неверный текущий пароль" }, 400);
  }
  updateUserPasswordHash(u.id, bcrypt.hashSync(next, 10));
  return c.json({ ok: true });
});

app.patch("/api/auth/email-notifications", async (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  let body: {
    email_notify_chat?: unknown;
    email_notify_raffles?: unknown;
    email_notify_raffle_orders?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const patch: {
    email_notify_chat?: boolean;
    email_notify_raffles?: boolean;
    email_notify_raffle_orders?: boolean;
  } = {};
  if (typeof body.email_notify_chat === "boolean") patch.email_notify_chat = body.email_notify_chat;
  if (typeof body.email_notify_raffles === "boolean") {
    patch.email_notify_raffles = body.email_notify_raffles;
  }
  if (typeof body.email_notify_raffle_orders === "boolean") {
    patch.email_notify_raffle_orders = body.email_notify_raffle_orders;
  }
  if (
    patch.email_notify_chat === undefined &&
    patch.email_notify_raffles === undefined &&
    patch.email_notify_raffle_orders === undefined
  ) {
    return c.json({ error: "Нет полей для сохранения" }, 400);
  }
  updateUserEmailNotifyPrefs(u.id, patch);
  const row = getUserById(u.id);
  return c.json({
    ok: true,
    email_notify_chat: row ? Number(row.email_notify_chat ?? 1) !== 0 : true,
    email_notify_raffles: row ? Number(row.email_notify_raffles ?? 1) !== 0 : true,
    email_notify_raffle_orders: row ? Number(row.email_notify_raffle_orders ?? 1) !== 0 : true,
  });
});

app.get("/api/chat/unread", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  c.header("Cache-Control", "private, no-store");
  return c.json({ unread_staff: countUnreadStaffMessagesForUser(u.id) });
});

app.post("/api/chat/mark-staff-read", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  markStaffMessagesReadByUser(u.id);
  c.header("Cache-Control", "private, no-store");
  return c.json({ ok: true, unread_staff: 0 });
});

app.get("/api/chat/messages", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  c.header("Cache-Control", "no-store");
  const rows = listSupportMessagesForUser(u.id);
  return c.json({
    messages: rows.map((r) => messageToDto(r)),
    staff_typing: getStaffTypingForUser(u.id),
  });
});

app.post("/api/chat/typing", async (c) => {
  const u = requireUser(c);
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
  const u = requireUser(c);
  if (u instanceof Response) return u;
  return handleChatFileUpload(c);
});

app.post("/api/admin/chat/upload", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  return handleChatFileUpload(c);
});

app.get("/api/admin/settings", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  return c.json(getSiteSettings());
});

app.patch("/api/admin/settings", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  let body: { maintenance_enabled?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  setMaintenanceEnabled(Boolean(body.maintenance_enabled));
  c.header("Cache-Control", "no-store");
  return c.json(getSiteSettings());
});

app.post("/api/chat/messages", async (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  let body: { body?: string; attachment?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const parsed = parseChatMessagePayload(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const id = insertSupportMessage(u.id, parsed.text, false, parsed.attachment);
  const row = getSupportMessageById(id);
  if (row) broadcastChatMessage(u.id, messageToDto(row));
  const rows = listSupportMessagesForUser(u.id);
  return c.json({
    messages: rows.map((r) => messageToDto(r)),
  });
});

app.get("/api/admin/users", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const list = listAdminThreadsWithMeta();
  return c.json({
    users: list.map((x) => ({
      id: x.id,
      phone: x.phone,
      name: x.name,
      email: x.email,
      role: x.role,
      blocked: x.blocked === 1,
      last_body: x.last_body,
      last_at: x.last_at,
      last_is_staff: x.last_is_staff,
      unread_count: x.unread_count,
    })),
  });
});

app.get("/api/admin/users/all", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const rawOff = c.req.query("offset");
  const rawLim = c.req.query("limit");
  const q = String(c.req.query("q") ?? "").trim();
  const offset = Number(rawOff ?? "0");
  const limit = Number(rawLim ?? "10");
  const safeOff = Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  const safeLim = Number.isFinite(limit) ? Math.min(Math.max(1, Math.floor(limit)), 100) : 10;
  const rows = listUsersForAdminPage(safeOff, safeLim, q || null);
  const total = q ? countUsersForAdminBySearch(q) : countUsersForAdmin();
  return c.json({
    users: rows.map((x) => ({
      id: x.id,
      phone: x.phone,
      name: x.name,
      email: x.email,
      role: x.role,
      blocked: x.blocked === 1,
      created_at: x.created_at,
    })),
    total,
    offset: safeOff,
    limit: safeLim,
  });
});

app.get("/api/admin/users/:userId/messages", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  const target = getUserById(userId);
  if (!target) return c.json({ error: "Пользователь не найден" }, 404);
  markThreadReadByStaff(userId);
  broadcastThreadReadByStaff(userId);
  const rows = listSupportMessagesForUser(userId);
  return c.json({
    user: {
      id: target.id,
      phone: target.phone,
      name: target.name,
      email:
        target.email != null && String(target.email).trim()
          ? String(target.email).trim().toLowerCase()
          : "",
      role: target.role ?? "user",
      blocked: target.blocked === 1,
    },
    messages: rows.map((r) => messageToDto(r)),
    user_typing: getUserTypingForThread(userId),
  });
});

/** Номерки пользователя по первой акции в списке (как «текущая» на сайте) */
app.get("/api/admin/users/:userId/latest-raffle-tickets", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  if (!getUserById(userId)) return c.json({ error: "Пользователь не найден" }, 404);
  c.header("Cache-Control", "no-store");
  const payload = adminUserTicketsForPrimaryRaffle(userId);
  return c.json(payload);
});

app.get("/api/admin/users/:userId/typing", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  c.header("Cache-Control", "no-store");
  return c.json({
    user_typing: getUserTypingForThread(userId),
  });
});

app.post("/api/admin/typing", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  let body: { userId?: number; active?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const targetId = Number(body.userId);
  if (!Number.isFinite(targetId)) return c.json({ error: "Некорректный id" }, 400);
  if (!getUserById(targetId)) return c.json({ error: "Пользователь не найден" }, 404);
  broadcastTypingStaffToUser(targetId, Boolean(body.active));
  return c.json({ ok: true });
});

app.get("/api/raffles", (c) => {
  const auth = requireUser(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "private, no-store");
  const rows = listRafflesPublic();
  return c.json({
    raffles: rows.map((r) => {
      const dto = raffleToDto(r);
      const occupied = Math.min(Math.max(0, getRaffleOccupiedCount(r.id)), Number(dto.ticket_count) || 0);
      const myOrder = getActiveOrderForUser(r.id, auth.id);
      const myOrderDto = myOrder ? orderToDto(myOrder) : null;
      return {
        ...dto,
        occupied_count: occupied,
        free_count: Math.max(0, Number(dto.ticket_count) - occupied),
        viewers_count: getRaffleViewerCount(r.id),
        my_order_status: myOrderDto?.status ?? null,
        my_order_id: myOrderDto?.id ?? null,
      };
    }),
  });
});

app.post("/api/raffles/:id/viewing", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id < 1) return c.json({ error: "Некорректный id" }, 400);
  const raffle = raffleVisibleOrActiveOrder(c, u, id);
  if (raffle instanceof Response) return raffle;
  touchRaffleViewer(id, u.id);
  return c.json({ ok: true });
});

/** Статические сегменты до «:id», иначе «cart» и «my-tickets» попадают в :id */
app.get("/api/raffles/cart", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  if (!rateLimitAllow(`get:cart:${u.id}`, 60, 60_000)) return rateLimitExceeded(c);
  c.header("Cache-Control", "private, no-store");
  const items = listReservedOrdersForUser(u.id).map((it) => ({
    ...it,
    payment_participation: buildRafflePaymentParticipationContext(u.id, it.order.raffle_id, it.order.id),
  }));
  return c.json({ items, server_time_ms: Date.now() });
});

app.post("/api/raffles/cart/clear", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  if (!rateLimitAllow(`post:cart-clear:${u.id}`, 15, 60_000)) return rateLimitExceeded(c);
  const r = clearAllUserReservedCartItems(u.id);
  if (!r.ok) return c.json({ error: r.error }, 400);
  broadcastRaffleTicketsUpdated(u.id);
  for (const rid of r.raffle_ids) notifyRaffleGridMutated(rid);
  return c.json({ ok: true, server_time_ms: Date.now() });
});

app.get("/api/raffles/my-tickets", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  if (!rateLimitAllow(`get:my-tickets:${u.id}`, 60, 60_000)) return rateLimitExceeded(c);
  c.header("Cache-Control", "private, no-store");
  return c.json({
    reserved: listReservedOrdersForUser(u.id),
    pending_review: listPendingReviewTicketGroupsForUser(u.id),
    confirmed: listConfirmedTicketGroupsForUser(u.id),
    wholesale_slots: listWholesaleSlotsForUser(u.id),
    server_time_ms: Date.now(),
  });
});

app.get("/api/raffles/:id", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = raffleVisibleOrActiveOrder(c, u, id);
  if (raffle instanceof Response) return raffle;
  c.header("Cache-Control", "private, no-store");
  return c.json({ raffle: raffleToDto(raffle) });
});

app.get("/api/raffles/:id/order", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = raffleVisibleOrActiveOrder(c, u, id);
  if (raffle instanceof Response) return raffle;
  const serverTimeMs = Date.now();
  const order = getActiveOrderForUser(id, u.id);
  if (!order) {
    return c.json({
      order: null,
      numbers: [],
      raffle: raffleToDto(raffle),
      server_time_ms: serverTimeMs,
      payment_participation: buildRafflePaymentParticipationContext(u.id, id, null),
    });
  }
  return c.json({
    order: orderToDto(order),
    numbers: getTicketNumbersForOrder(order.id),
    raffle: raffleToDto(raffle),
    server_time_ms: serverTimeMs,
    payment_participation: buildRafflePaymentParticipationContext(u.id, id, order.id),
  });
});

app.get("/api/raffles/:id/tickets", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  if (!rateLimitAllow(`get:tickets-slice:${u.id}`, 180, 60_000)) return rateLimitExceeded(c);
  const id = Number(c.req.param("id"));
  const from = Number(c.req.query("from") || "1");
  const to = Number(c.req.query("to") || "500");
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = raffleVisibleOrActiveOrder(c, u, id);
  if (raffle instanceof Response) return raffle;
  const slice = getTicketGridSlice(id, u.id, from, to);
  return c.json({ ...slice, raffle: raffleToDto(raffle) });
});

app.get("/api/raffles/:id/ticket-lookup", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  if (!rateLimitAllow(`get:ticket-lookup:${u.id}`, 120, 60_000)) return rateLimitExceeded(c);
  const id = Number(c.req.param("id"));
  const n = Number(c.req.query("n"));
  if (!Number.isFinite(id) || !Number.isFinite(n)) {
    return c.json({ error: "Некорректные данные" }, 400);
  }
  const raffle = raffleVisibleOrActiveOrder(c, u, id);
  if (raffle instanceof Response) return raffle;
  if (n < 1 || n > raffle.ticket_count) return c.json({ error: "Некорректный номер" }, 400);
  const kind = getTicketCellKind(id, Math.floor(n), u.id);
  return c.json({ n: Math.floor(n), kind });
});

app.post("/api/raffles/orders/:orderId/add-tickets", async (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  let body: { numbers?: number[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const numbers = Array.isArray(body.numbers) ? body.numbers : [];
  const r = addTicketsToReservedOrder(orderId, u.id, numbers);
  if (!r.ok) return c.json({ error: r.error }, 400);
  const order = getOrderByIdForUser(orderId, u.id);
  broadcastRaffleTicketsUpdated(u.id);
  if (order) notifyRaffleGridMutated(order.raffle_id);
  const serverTimeMs = Date.now();
  return c.json({
    order: order ? orderToDto(order) : null,
    numbers: getTicketNumbersForOrder(orderId),
    server_time_ms: serverTimeMs,
  });
});

app.post("/api/raffles/orders/:orderId/random-tickets", async (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  let body: { count?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const count = Math.floor(Number(body.count ?? 1));
  const r = appendRandomTicketsToReservedOrder(orderId, u.id, count);
  if (!r.ok) return c.json({ error: r.error }, 400);
  const order = getOrderByIdForUser(orderId, u.id);
  broadcastRaffleTicketsUpdated(u.id);
  if (order) notifyRaffleGridMutated(order.raffle_id);
  const serverTimeMs = Date.now();
  return c.json({
    order: order ? orderToDto(order) : null,
    numbers: getTicketNumbersForOrder(orderId),
    picked: r.picked,
    server_time_ms: serverTimeMs,
  });
});

app.delete("/api/raffles/orders/:orderId/tickets/:ticketNum", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  if (!rateLimitAllow(`del:ticket:${u.id}`, 45, 60_000)) return rateLimitExceeded(c);
  const orderId = Number(c.req.param("orderId"));
  const ticketNum = Number(c.req.param("ticketNum"));
  if (!Number.isFinite(orderId) || !Number.isFinite(ticketNum)) {
    return c.json({ error: "Некорректный id" }, 400);
  }
  const orderBefore = getOrderByIdForUser(orderId, u.id);
  const r = removeTicketFromReservedOrder(orderId, u.id, ticketNum);
  if (!r.ok) return c.json({ error: r.error }, 400);
  broadcastRaffleTicketsUpdated(u.id);
  if (orderBefore) notifyRaffleGridMutated(orderBefore.raffle_id);
  const serverTimeMs = Date.now();
  return c.json({ order: r.order, numbers: r.numbers, server_time_ms: serverTimeMs });
});

app.get("/api/raffles/orders/:orderId", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  const order = getOrderByIdForUser(orderId, u.id);
  if (!order) return c.json({ error: "Не найдено" }, 404);
  const raffle = getRaffleById(order.raffle_id);
  if (!raffle) return c.json({ error: "Не найдено" }, 404);
  c.header("Cache-Control", "private, no-store");
  const serverTimeMs = Date.now();
  return c.json({
    order: orderToDto(order),
    numbers: getTicketNumbersForOrder(orderId),
    raffle: raffleToDto(raffle),
    server_time_ms: serverTimeMs,
    payment_participation: buildRafflePaymentParticipationContext(u.id, order.raffle_id, order.id),
  });
});

app.post("/api/raffles/orders/:orderId/extend-reservation", (c) => {
  return c.json({ error: "Продление брони недоступно" }, 400);
});

app.post("/api/raffles/:id/reserve", async (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  if (!rateLimitAllow(`post:reserve:${u.id}`, 25, 60_000)) return rateLimitExceeded(c);
  const id = Number(c.req.param("id"));
  let body: { numbers?: number[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const numbers = Array.isArray(body.numbers) ? body.numbers : [];
  const r = createReservation(id, u.id, numbers);
  if (!r.ok) return c.json({ error: r.error }, 400);
  const order = getOrderByIdForUser(r.order_id, u.id);
  if (!order) return c.json({ error: "Ошибка создания заявки" }, 500);
  const nums = getTicketNumbersForOrder(r.order_id);
  broadcastRaffleTicketsUpdated(u.id);
  notifyRaffleGridMutated(id);
  const serverTimeMs = Date.now();
  return c.json({
    order: orderToDto(order),
    numbers: nums,
    reserved_until: r.reserved_until,
    server_time_ms: serverTimeMs,
    skipped_still_occupied: r.skipped_still_occupied,
    released_after_cleanup: r.released_after_cleanup,
    payment_participation: buildRafflePaymentParticipationContext(u.id, id, order.id),
  });
});

app.post("/api/raffles/orders/:orderId/cancel-reservation", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  if (!rateLimitAllow(`post:cancel-reservation:${u.id}`, 20, 60_000)) return rateLimitExceeded(c);
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  const res = userCancelReservedRaffleOrder(orderId, u.id);
  if (!res.ok) return c.json({ error: res.error }, 400);
  const orderRow = getOrderById(orderId);
  const raffleId = orderRow && Number.isFinite(Number(orderRow.raffle_id)) ? Number(orderRow.raffle_id) : 0;
  broadcastRaffleTicketsUpdated(u.id);
  if (raffleId > 0) notifyRaffleGridMutated(raffleId);
  return c.json({ ok: true, server_time_ms: Date.now() });
});

app.patch("/api/raffles/orders/:orderId/bank", async (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  let body: { bank?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const bank = body.bank === "sber" || body.bank === "other" ? body.bank : null;
  if (!bank) return c.json({ error: "Укажите банк: sber или other" }, 400);
  const res = setOrderBank(orderId, u.id, bank);
  if (!res.ok) return c.json({ error: res.error }, 400);
  const order = getOrderByIdForUser(orderId, u.id);
  if (!order) return c.json({ error: "Ошибка" }, 500);
  return c.json({ order: orderToDto(order), server_time_ms: Date.now() });
});

app.post("/api/raffles/receipt-upload", async (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  return handleReceiptFileUpload(c);
});

app.post("/api/raffles/orders/:orderId/receipt", async (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  let body: { url?: string; name?: string; mime?: string; sha256?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const url = String(body.url ?? "").trim();
  const name = String(body.name ?? "чек").slice(0, 255);
  const mime = String(body.mime ?? "application/octet-stream").slice(0, 120);
  const sha256 = String(body.sha256 ?? "").trim().toLowerCase();
  const res = attachReceiptToOrder(orderId, u.id, { url, name, mime, sha256 });
  if (!res.ok) return c.json({ error: res.error }, 400);
  const order = getOrderByIdForUser(orderId, u.id);
  if (!order) return c.json({ error: "Ошибка" }, 500);
  broadcastRaffleTicketsUpdated(u.id);
  notifyRaffleGridMutated(order.raffle_id);
  return c.json({
    order: orderToDto(order),
    server_time_ms: Date.now(),
    payment_participation: buildRafflePaymentParticipationContext(u.id, order.raffle_id, order.id),
  });
});

app.post("/api/admin/broadcast-max-chat-invite", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  if (!rateLimitAllow(`post:broadcast-max:${auth.id}`, 2, 120_000)) {
    return rateLimitExceeded(c);
  }
  const userIds = listUserIdsWithConfirmedRaffleOrders();
  if (!userIds.length) {
    return c.json({ ok: true, sent: 0, total: 0, message: "Нет пользователей с подтверждёнными оплатами" });
  }
  const body = buildStaffMaxPrivateInviteOnlyChatBody();
  let sent = 0;
  const errors: string[] = [];
  for (const uid of userIds) {
    try {
      const msgId = insertSupportMessage(uid, body, true, null);
      markThreadReadByStaff(uid);
      broadcastThreadReadByStaff(uid);
      const row = getSupportMessageById(msgId);
      if (row) broadcastChatMessage(uid, messageToDto(row));
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`user ${uid}: ${msg}`);
    }
  }
  return c.json({
    ok: true,
    sent,
    total: userIds.length,
    errors: errors.length ? errors.slice(0, 5) : [],
  });
});

app.get("/api/admin/raffle-payments", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const rows = listPendingPayments();
  const active = listActiveOrdersForAdmin();
  return c.json({
    server_time_ms: Date.now(),
    payments: rows.map((row) => ({
      ...orderToDto(row),
      raffle_title: row.raffle_title,
      user_phone: row.user_phone,
      user_name: row.user_name,
      user_id: row.user_id,
      receipt_history_prior: listReceiptHistoryPriorForPendingOrder(
        row.user_id,
        row.raffle_id,
        row.id,
        row.receipt_url,
      ),
    })),
    active_orders: active.map((row) => ({
      ...orderToDto(row),
      raffle_title: row.raffle_title,
      user_phone: row.user_phone,
      user_name: row.user_name,
      user_id: row.user_id,
    })),
  });
});

app.post("/api/admin/raffle-payments/:orderId/confirm", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  const owner = listPendingPayments().find((p) => Number(p.id) === orderId);
  const ticketNumsBefore = getTicketNumbersForOrder(orderId);
  const res = confirmOrderByAdmin(orderId);
  if (!res.ok) return c.json({ error: res.error }, 400);
  if (owner && Number.isFinite(Number(owner.user_id))) {
    const uid = Number(owner.user_id);
    try {
      const title = String(owner.raffle_title ?? "").trim() || "Акция";
      const body = buildStaffRaffleReceiptConfirmedChatBody(title, ticketNumsBefore);
      const msgId = insertSupportMessage(uid, body, true, null);
      markThreadReadByStaff(uid);
      broadcastThreadReadByStaff(uid);
      const row = getSupportMessageById(msgId);
      if (row) broadcastChatMessage(uid, messageToDto(row));
      notifyUserEmailStaffReply(uid, { body, attachmentName: null, attachmentMime: null });
    } catch (e) {
      console.error(
        "[admin/raffle-payments confirm] chat notify:",
        e instanceof Error ? e.message : e,
      );
    }
    broadcastRaffleTicketsUpdated(uid);
  }
  notifyRaffleGridMutated(owner?.raffle_id);
  return c.json({ ok: true });
});

app.post("/api/admin/raffle-payments/:orderId/reject", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  let adminNote = "";
  try {
    const body = (await c.req.json()) as { comment?: unknown };
    adminNote = String(body?.comment ?? "").trim().slice(0, 500);
  } catch {
    adminNote = "";
  }
  const pendingRow = listPendingPayments().find((p) => Number(p.id) === orderId);
  const res = rejectOrderByAdmin(orderId, { adminNote });
  if (!res.ok) return c.json({ error: res.error }, 400);
  if (pendingRow && Number.isFinite(Number(pendingRow.user_id))) {
    const uid = Number(pendingRow.user_id);
    const updated = getOrderById(orderId);
    const raffle = getRaffleById(pendingRow.raffle_id);
    const tok = updated ? String((updated as { public_status_token?: string }).public_status_token ?? "").trim() : "";
    const statusPageUrl = tok
      ? `${publicAppOrigin()}/home/order-status?t=${encodeURIComponent(tok)}`
      : "";
    const rulesUrl = raffle ? String(raffle.rules_url ?? "").trim() : "";
    if (updated && raffle) {
      if (res.mode === "rework") {
        notifyUserReceiptRejectedRework(uid, {
          raffleTitle: raffle.title,
          orderPublicId: `A${orderId}`,
          amountRub: updated.amount_rub,
          ticketCount: updated.ticket_count,
          reservedUntilMs: updated.reserved_until,
          openRaffleUrl: `${publicAppOrigin()}/home/raffle?id=${encodeURIComponent(String(raffle.id))}`,
          adminNote,
          statusPageUrl,
          rulesUrl,
        });
      } else {
        notifyUserOrderFullyReleased(uid, {
          raffleTitle: raffle.title,
          orderPublicId: `A${orderId}`,
          reason: "Заявка отменена: исчерпан лимит повторных загрузок чека",
          openHomeUrl: `${publicAppOrigin()}/home`,
          statusPageUrl,
          rulesUrl,
          adminNote,
        });
      }
    }
    broadcastRaffleTicketsUpdated(uid);
  }
  notifyRaffleGridMutated(pendingRow?.raffle_id);
  return c.json({ ok: true, mode: res.mode });
});

app.post("/api/admin/raffle-orders/:orderId/release", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  let adminNote = "";
  try {
    const body = (await c.req.json()) as { comment?: unknown };
    adminNote = String(body?.comment ?? "").trim().slice(0, 500);
  } catch {
    adminNote = "";
  }
  const before = getOrderById(orderId);
  const res = adminFullyReleaseRaffleOrder(orderId, adminNote || null);
  if (!res.ok) return c.json({ error: res.error }, 400);
  if (before && Number.isFinite(Number(before.user_id))) {
    const uid = Number(before.user_id);
    const raffle = getRaffleById(before.raffle_id);
    const tok = String((before as { public_status_token?: string }).public_status_token ?? "").trim();
    const statusPageUrl = tok
      ? `${publicAppOrigin()}/home/order-status?t=${encodeURIComponent(tok)}`
      : "";
    const rulesUrl = raffle ? String(raffle.rules_url ?? "").trim() : "";
    if (raffle) {
      notifyUserOrderFullyReleased(uid, {
        raffleTitle: raffle.title,
        orderPublicId: `A${orderId}`,
        reason: "Бронь снята администратором",
        openHomeUrl: `${publicAppOrigin()}/home`,
        statusPageUrl,
        rulesUrl,
        adminNote,
      });
    }
    broadcastRaffleTicketsUpdated(uid);
  }
  notifyRaffleGridMutated(before?.raffle_id);
  return c.json({ ok: true });
});

app.get("/api/admin/raffles", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const rows = listRafflesAll();
  return c.json({
    raffles: rows.map((r) => raffleToDto(r, { forAdmin: true })),
  });
});

app.post("/api/admin/raffles/upload", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
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
  const blob = raw as { type?: string; arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof blob.arrayBuffer !== "function") {
    return c.json({ error: "Некорректный файл" }, 400);
  }
  const ab = await blob.arrayBuffer();
  const buffer = Buffer.from(ab);
  if (buffer.length > 5 * 1024 * 1024) {
    return c.json({ error: "Файл не больше 5 МБ" }, 400);
  }
  const mime = String(blob.type || "").toLowerCase();
  const extMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  const ext = extMap[mime];
  if (!ext) {
    return c.json({ error: "Допустимы JPEG, PNG, WebP, GIF" }, 400);
  }
  const name = `${randomUUID()}${ext}`;
  await writeUploadToDirs(raffleUploadsDirs, name, buffer);
  const url = `/uploads/raffles/${name}`;
  return c.json({ url });
});

app.post("/api/admin/raffles", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const parsed = parseRaffleBody(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const v = parsed.value;
  const id = insertRaffle({
    title: v.title,
    cover_image_url: v.cover_image_url,
    price_rub: v.price_rub,
    old_price_rub: v.old_price_rub,
    ticket_count: v.ticket_count,
    collection_url: v.collection_url,
    tbank_collection_url: v.tbank_collection_url,
    collection_recipient: v.collection_recipient,
    sber_collection_recipient: v.sber_collection_recipient,
    tbank_collection_recipient: v.tbank_collection_recipient,
    qr_image_url: v.qr_image_url,
    qr_recipient: v.qr_recipient,
    qr_payment_purpose: v.qr_payment_purpose,
    sber_enabled: v.sber_enabled ? 1 : 0,
    tbank_enabled: v.tbank_enabled ? 1 : 0,
    qr_enabled: v.qr_enabled ? 1 : 0,
    rules_url: v.rules_url,
    status: v.status,
    sort_order: v.sort_order,
    wholesale_enabled: v.wholesale_enabled ? 1 : 0,
    hidden_from_public: v.hidden_from_public ? 1 : 0,
  });
  void maybeSendRaffleLaunchEmails(id).catch((e) =>
    console.error("[admin/raffles POST] notify:", e instanceof Error ? e.message : e),
  );
  broadcastRafflesFeedUpdated();
  const row = getRaffleById(id);
  return c.json({ raffle: row ? raffleToDto(row, { forAdmin: true }) : null });
});

app.patch("/api/admin/raffles/:id", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const existing = getRaffleById(id);
  if (!existing) return c.json({ error: "Акция не найдена" }, 404);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const parsed = parseRaffleBody(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const v = parsed.value;
  updateRaffle(id, {
    title: v.title,
    cover_image_url: v.cover_image_url,
    price_rub: v.price_rub,
    old_price_rub: v.old_price_rub,
    ticket_count: v.ticket_count,
    collection_url: v.collection_url,
    tbank_collection_url: v.tbank_collection_url,
    collection_recipient: v.collection_recipient,
    sber_collection_recipient: v.sber_collection_recipient,
    tbank_collection_recipient: v.tbank_collection_recipient,
    qr_image_url: v.qr_image_url,
    qr_recipient: v.qr_recipient,
    qr_payment_purpose: v.qr_payment_purpose,
    sber_enabled: v.sber_enabled ? 1 : 0,
    tbank_enabled: v.tbank_enabled ? 1 : 0,
    qr_enabled: v.qr_enabled ? 1 : 0,
    rules_url: v.rules_url,
    status: v.status,
    sort_order: v.sort_order,
    wholesale_enabled: v.wholesale_enabled ? 1 : 0,
    hidden_from_public: v.hidden_from_public ? 1 : 0,
  });
  recalculateWholesaleForRaffle(id);
  void maybeSendRaffleLaunchEmails(id).catch((e) =>
    console.error("[admin/raffles PATCH] notify:", e instanceof Error ? e.message : e),
  );
  broadcastRafflesFeedUpdated();
  const row = getRaffleById(id);
  return c.json({ raffle: row ? raffleToDto(row, { forAdmin: true }) : null });
});

app.delete("/api/admin/raffles/:id", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const existing = getRaffleById(id);
  if (!existing) return c.json({ error: "Акция не найдена" }, 404);
  deleteRaffle(id);
  broadcastRafflesFeedUpdated();
  return c.json({ ok: true });
});

app.get("/api/admin/raffles/:id/participants", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = getRaffleById(id);
  if (!raffle) return c.json({ error: "Акция не найдена" }, 404);
  c.header("Cache-Control", "no-store");
  const bundle = getAdminRaffleParticipantsBundle(id);
  return c.json({
    wholesale_enabled: bundle.wholesale_enabled,
    participants: bundle.participants.map((row) => ({
      ticket_number: row.ticket_number,
      user_phone: row.user_phone,
      order_status: row.order_status,
      is_wholesale: row.is_wholesale,
      user_id: row.user_id,
      user_name: row.user_name,
      user_email: row.user_email,
    })),
    wholesalers: bundle.wholesalers,
  });
});

app.get("/api/admin/raffles/:id/tickets/:ticketNumber/availability", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = getRaffleById(id);
  if (!raffle) return c.json({ error: "Акция не найдена" }, 404);
  const ticketNumber = Number(c.req.param("ticketNumber"));
  const n = Math.floor(ticketNumber);
  if (!Number.isFinite(n) || n < 1 || n > raffle.ticket_count) {
    return c.json({ error: "Некорректный номерок" }, 400);
  }
  const is_free = !isRaffleTicketBlocked(id, n);
  return c.json({ ticket_number: n, is_free });
});

app.post("/api/admin/raffles/:id/bulk-assign-phones", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = getRaffleById(id);
  if (!raffle) return c.json({ error: "Акция не найдена" }, 404);
  let body: { text?: string; start_number?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const text = String(body.text ?? "");
  const startNum =
    body.start_number !== undefined && body.start_number !== null
      ? Number(body.start_number)
      : 1;
  const lines = text.split(/\r?\n/);
  const r = adminBulkAssignPhoneLinesToRaffle(id, lines, startNum);
  if (!r.ok) return c.json({ error: r.error }, 400);
  if (r.assigned > 0) notifyRaffleGridMutated(id);
  return c.json({ assigned: r.assigned, skipped: r.skipped });
});

app.post("/api/admin/raffles/:id/assign-phone-ticket", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  let body: { phone?: unknown; ticket_number?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const phone = normalizePhone(String(body.phone ?? ""));
  if (!phone || !isValidRuMobile(phone)) {
    return c.json({ error: "Некорректный мобильный номер РФ" }, 400);
  }
  const ticket_number = Number(body.ticket_number);
  if (!Number.isFinite(ticket_number)) return c.json({ error: "Некорректный номерок" }, 400);
  const res = adminAssignPhoneToExactTicket(id, phone, ticket_number);
  if (!res.ok) return c.json({ error: res.error }, 400);
  notifyRaffleGridMutated(id);
  return c.json({ ok: true });
});

app.delete("/api/admin/raffles/:id/participant-tickets/:ticketNumber", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  const ticketNumber = Number(c.req.param("ticketNumber"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  if (!Number.isFinite(ticketNumber)) return c.json({ error: "Некорректный номерок" }, 400);
  const raffle = getRaffleById(id);
  if (!raffle) return c.json({ error: "Акция не найдена" }, 404);
  const r = adminDetachParticipantTicket(id, ticketNumber);
  if (!r.ok) return c.json({ error: r.error }, 400);
  notifyRaffleGridMutated(id);
  if (r.affected_user_id != null) broadcastRaffleTicketsUpdated(r.affected_user_id);
  return c.json({ ok: true });
});

app.patch("/api/admin/users/:userId", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  const target = getUserById(userId);
  if (!target) return c.json({ error: "Пользователь не найден" }, 404);
  let body: { name?: string; phone?: string; email?: string; role?: string; blocked?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }

  const wantsProfile =
    body.name !== undefined || body.phone !== undefined || body.email !== undefined;

  if (wantsProfile) {
    const name = String(body.name ?? target.name).trim();
    const phoneRaw = body.phone !== undefined ? String(body.phone) : target.phone;

    let emailFinal: string | null;
    if (body.email !== undefined) {
      const raw = String(body.email).trim().toLowerCase();
      if (!raw) {
        emailFinal = null;
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        return c.json({ error: "Укажите корректный email" }, 400);
      } else {
        emailFinal = raw;
      }
    } else {
      const t = target.email != null ? String(target.email).trim().toLowerCase() : "";
      emailFinal = t || null;
    }

    const phone = normalizePhone(phoneRaw);
    if (!phone) return c.json({ error: "Введите корректный телефон" }, 400);
    if (!isValidRuMobile(phone)) {
      return c.json({ error: "Нужен мобильный номер России (+7 9XX …)" }, 400);
    }
    if (!name) return c.json({ error: "Укажите имя" }, 400);

    const existing = getUserByPhone(phone);
    if (existing && existing.id !== userId) {
      return c.json({ error: "Этот номер уже занят другим пользователем" }, 409);
    }
    if (emailFinal) {
      const existingEmail = getUserByEmail(emailFinal);
      if (existingEmail && existingEmail.id !== userId) {
        return c.json({ error: "Этот email уже занят другим пользователем" }, 409);
      }
    }

    updateUserProfile(userId, { name, phone, email: emailFinal });
  }

  if (body.role !== undefined) {
    const role = String(body.role).toLowerCase() === "admin" ? "admin" : "user";
    const wasAdmin = (target.role ?? "user") === "admin";
    if (role === "user" && wasAdmin && countActiveAdmins() === 1) {
      return c.json({ error: "Нельзя снять последнего администратора" }, 400);
    }
    updateUserRole(userId, role);
  }

  if (body.blocked !== undefined) {
    const blocked = Boolean(body.blocked) ? 1 : 0;
    if (blocked === 1) {
      if (userId === auth.id) {
        return c.json({ error: "Нельзя заблокировать собственный аккаунт" }, 400);
      }
      const t2 = getUserById(userId);
      if (t2 && (t2.role ?? "user") === "admin" && countActiveAdmins() === 1) {
        return c.json({ error: "Нельзя заблокировать последнего администратора" }, 400);
      }
    }
    updateUserBlocked(userId, blocked);
  }

  const updated = getUserById(userId);
  if (!updated) return c.json({ error: "Ошибка сохранения" }, 500);
  return c.json({
    user: {
      id: updated.id,
      phone: updated.phone,
      name: updated.name,
      email:
        updated.email != null && String(updated.email).trim()
          ? String(updated.email).trim().toLowerCase()
          : "",
      role: updated.role ?? "user",
      blocked: updated.blocked === 1,
    },
  });
});

app.post("/api/admin/users/:userId/messages", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  const target = getUserById(userId);
  if (!target) return c.json({ error: "Пользователь не найден" }, 404);
  let body: { body?: string; attachment?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const parsed = parseChatMessagePayload(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const id = insertSupportMessage(userId, parsed.text, true, parsed.attachment);
  markThreadReadByStaff(userId);
  broadcastThreadReadByStaff(userId);
  const row = getSupportMessageById(id);
  if (row) broadcastChatMessage(userId, messageToDto(row));
  notifyUserEmailStaffReply(userId, {
    body: parsed.text,
    attachmentName: parsed.attachment?.name ?? null,
    attachmentMime: parsed.attachment?.mime ?? null,
  });
  const rows = listSupportMessagesForUser(userId);
  return c.json({
    messages: rows.map((r) => messageToDto(r)),
  });
});

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
  console.log(`SQLite: ./data/app.db`);
  if (String(process.env.DISABLE_RAFFLE_MAIL_INTERVAL ?? "").trim() !== "1") {
    tickReserveExpiryEmailReminders();
    setInterval(tickReserveExpiryEmailReminders, 60_000);
  } else {
    console.log("[mail] INTERVAL отключён — используйте CRON → GET /api/internal/cron/raffle-mail-tick?secret=…");
  }
});
