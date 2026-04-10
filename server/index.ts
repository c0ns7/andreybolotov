import "dotenv/config";
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
  insertSupportMessage,
  insertUser,
  listAdminThreadsWithMeta,
  listSupportMessagesForUser,
  markThreadReadByStaff,
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
  raffleToDto,
} from "./db.js";
import {
  attachWebSocket,
  broadcastChatMessage,
  broadcastThreadReadByStaff,
  broadcastTypingStaffToUser,
  broadcastTypingUserToAdmins,
} from "./ws-chat.js";
import { getStaffTypingForUser, getUserTypingForThread } from "./typing-state.js";
import type { Context } from "hono";
import type { SessionUser } from "./db.js";
import { isValidRuMobile, normalizePhone } from "./phone.js";
import { extForChatMime, parseChatAttachmentFromMessage } from "./chat-attachments.js";
import {
  attachReceiptToOrder,
  confirmOrderByAdmin,
  createReservation,
  getActiveOrderForUser,
  getOrderByIdForUser,
  getTicketGridSlice,
  getTicketNumbersForOrder,
  listPendingPayments,
  getAdminRaffleParticipantsBundle,
  recalculateWholesaleForRaffle,
  addTicketsToReservedOrder,
  appendRandomTicketsToReservedOrder,
  getTicketCellKind,
  listConfirmedTicketGroupsForUser,
  listReservedOrdersForUser,
  orderToDto,
  rejectOrderByAdmin,
  removeTicketFromReservedOrder,
  setOrderBank,
  extendReservedOrderOnce,
} from "./raffle-orders.js";
import { sendPasswordResetEmail, isSmtpReady } from "./mail.js";

const PORT = Number(process.env.PORT) || 3000;

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
  const origName = String(blob.name || "чек")
    .replace(/[<>\"]/g, "")
    .slice(0, 255);
  return c.json({ url, name: origName || "чек", mime });
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

app.get("/api/health", (c) =>
  c.json({ ok: true, service: "andreybolotov-api", ts: Date.now() }),
);

function authUser(c: Context): SessionUser | null {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return getUserBySessionToken(token) ?? null;
}

function requireUser(c: Context): SessionUser | Response {
  const u = authUser(c);
  if (!u) return c.json({ error: "Не авторизован" }, 401);
  return u;
}

function requireAdmin(c: Context): SessionUser | Response {
  const u = authUser(c);
  if (!u) return c.json({ error: "Не авторизован" }, 401);
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

function normalizeRaffleStatus(s: string): "active" | "closed" | "paused" {
  if (s === "closed" || s === "paused") return s;
  return "active";
}

type RaffleInput = {
  title: string;
  cover_image_url: string;
  price_rub: number;
  ticket_count: number;
  collection_url: string;
  collection_recipient: string;
  qr_image_url: string;
  status: "active" | "closed" | "paused";
  sort_order: number;
  wholesale_enabled: boolean;
};

function parseRaffleBody(body: Record<string, unknown>): { ok: true; value: RaffleInput } | { ok: false; error: string } {
  const title = String(body.title ?? "").trim();
  if (!title) return { ok: false, error: "Укажите заголовок" };
  if (title.length > 500) return { ok: false, error: "Заголовок слишком длинный" };

  const cover_image_url = String(body.cover_image_url ?? "").trim();
  const collection_url = String(body.collection_url ?? "").trim();
  const collection_recipient = String(body.collection_recipient ?? "").trim();
  const qr_image_url = String(body.qr_image_url ?? "").trim();

  const price_rub = Math.floor(Number(body.price_rub));
  const ticket_count = Math.floor(Number(body.ticket_count));
  if (!Number.isFinite(price_rub) || price_rub < 0 || price_rub > 1_000_000_000) {
    return { ok: false, error: "Некорректная цена билета" };
  }
  if (!Number.isFinite(ticket_count) || ticket_count < 0 || ticket_count > 100_000_000) {
    return { ok: false, error: "Некорректное количество номерков" };
  }

  const sort_order = Math.floor(Number(body.sort_order ?? 0));
  if (!Number.isFinite(sort_order)) {
    return { ok: false, error: "Некорректный порядок сортировки" };
  }

  const hasCollectionPayment = Boolean(collection_url);
  const hasQrPayment = Boolean(qr_image_url);
  const hasAnyPayment = hasCollectionPayment || hasQrPayment;
  const status = hasAnyPayment
    ? normalizeRaffleStatus(String(body.status ?? "active"))
    : "paused";

  const wholesale_enabled = Boolean(body.wholesale_enabled);

  return {
    ok: true,
    value: {
      title,
      cover_image_url,
      price_rub,
      ticket_count,
      collection_url,
      collection_recipient,
      qr_image_url,
      status,
      sort_order,
      wholesale_enabled,
    },
  };
}

app.post("/api/auth/register", async (c) => {
  let body: { phone?: string; name?: string; email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const phone = normalizePhone(String(body.phone ?? ""));
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!phone) return c.json({ error: "Введите полный номер телефона" }, 400);
  if (!isValidRuMobile(phone)) {
    return c.json({ error: "Нужен мобильный номер России (+7 9XX …)" }, 400);
  }
  if (!name) return c.json({ error: "Укажите ФИО" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return c.json({ error: "Укажите корректный email" }, 400);
  if (password.length < 6) return c.json({ error: "Пароль не короче 6 символов" }, 400);

  if (getUserByPhone(phone)) {
    return c.json({ error: "Этот номер телефона уже зарегистрирован" }, 409);
  }
  if (getUserByEmail(email)) {
    return c.json({ error: "Этот email уже зарегистрирован" }, 409);
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = insertUser(phone, name, email, passwordHash);
  const row = getUserById(userId);
  const token = randomUUID();
  createSession(token, userId);
  return c.json({
    token,
    user: {
      phone,
      name,
      email,
      role: row?.role ?? "user",
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

  const token = randomUUID();
  createSession(token, user.id);

  return c.json({
    token,
    user: {
      phone: user.phone,
      name: user.name,
      email: user.email,
      role: user.role ?? "user",
    },
  });
});

app.get("/api/auth/me", (c) => {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return c.json({ error: "Не авторизован" }, 401);
  const user = getUserBySessionToken(token);
  if (!user) return c.json({ error: "Не авторизован" }, 401);
  return c.json({
    user: {
      phone: user.phone,
      name: user.name,
      email: user.email,
      role: user.role ?? "user",
    },
  });
});

app.post("/api/auth/logout", (c) => {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) deleteSession(token);
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
  try {
    await sendPasswordResetEmail(user.email, resetUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auth/forgot] SMTP:", msg, e);
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
      last_body: x.last_body,
      last_at: x.last_at,
      last_is_staff: x.last_is_staff,
      unread_count: x.unread_count,
    })),
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
      email: target.email,
      role: target.role ?? "user",
    },
    messages: rows.map((r) => messageToDto(r)),
    user_typing: getUserTypingForThread(userId),
  });
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
  const rows = listRafflesAll();
  return c.json({
    raffles: rows.map((r) => raffleToDto(r)),
  });
});

/** Статические сегменты до «:id», иначе «cart» и «my-tickets» попадают в :id */
app.get("/api/raffles/cart", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  if (!rateLimitAllow(`get:cart:${u.id}`, 60, 60_000)) return rateLimitExceeded(c);
  c.header("Cache-Control", "private, no-store");
  const items = listReservedOrdersForUser(u.id);
  return c.json({ items });
});

app.get("/api/raffles/my-tickets", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  if (!rateLimitAllow(`get:my-tickets:${u.id}`, 60, 60_000)) return rateLimitExceeded(c);
  c.header("Cache-Control", "private, no-store");
  return c.json({
    reserved: listReservedOrdersForUser(u.id),
    confirmed: listConfirmedTicketGroupsForUser(u.id),
  });
});

app.get("/api/raffles/:id", (c) => {
  const auth = requireUser(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = getRaffleById(id);
  if (!raffle) return c.json({ error: "Не найдено" }, 404);
  c.header("Cache-Control", "private, no-store");
  return c.json({ raffle: raffleToDto(raffle) });
});

app.get("/api/raffles/:id/order", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = getRaffleById(id);
  if (!raffle) return c.json({ error: "Не найдено" }, 404);
  const order = getActiveOrderForUser(id, u.id);
  if (!order) {
    return c.json({ order: null, numbers: [], raffle: raffleToDto(raffle) });
  }
  return c.json({
    order: orderToDto(order),
    numbers: getTicketNumbersForOrder(order.id),
    raffle: raffleToDto(raffle),
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
  const raffle = getRaffleById(id);
  if (!raffle) return c.json({ error: "Не найдено" }, 404);
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
  const raffle = getRaffleById(id);
  if (!raffle) return c.json({ error: "Не найдено" }, 404);
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
  return c.json({
    order: order ? orderToDto(order) : null,
    numbers: getTicketNumbersForOrder(orderId),
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
  return c.json({
    order: order ? orderToDto(order) : null,
    numbers: getTicketNumbersForOrder(orderId),
    picked: r.picked,
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
  const r = removeTicketFromReservedOrder(orderId, u.id, ticketNum);
  if (!r.ok) return c.json({ error: r.error }, 400);
  return c.json({ order: r.order, numbers: r.numbers });
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
  return c.json({
    order: orderToDto(order),
    numbers: getTicketNumbersForOrder(orderId),
    raffle: raffleToDto(raffle),
  });
});

app.post("/api/raffles/orders/:orderId/extend-reservation", (c) => {
  const u = requireUser(c);
  if (u instanceof Response) return u;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  const r = extendReservedOrderOnce(orderId, u.id);
  if (!r.ok) return c.json({ error: r.error }, 400);
  return c.json({ order: r.order });
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
  return c.json({ order: orderToDto(order), numbers: nums, reserved_until: r.reserved_until });
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
  return c.json({ order: orderToDto(order) });
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
  let body: { url?: string; name?: string; mime?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const url = String(body.url ?? "").trim();
  const name = String(body.name ?? "чек").slice(0, 255);
  const mime = String(body.mime ?? "application/octet-stream").slice(0, 120);
  const res = attachReceiptToOrder(orderId, u.id, { url, name, mime });
  if (!res.ok) return c.json({ error: res.error }, 400);
  const order = getOrderByIdForUser(orderId, u.id);
  if (!order) return c.json({ error: "Ошибка" }, 500);
  return c.json({ order: orderToDto(order) });
});

app.get("/api/admin/raffle-payments", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const rows = listPendingPayments();
  return c.json({
    payments: rows.map((row) => ({
      ...orderToDto(row),
      raffle_title: row.raffle_title,
      user_phone: row.user_phone,
      user_name: row.user_name,
    })),
  });
});

app.post("/api/admin/raffle-payments/:orderId/confirm", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  const res = confirmOrderByAdmin(orderId);
  if (!res.ok) return c.json({ error: res.error }, 400);
  return c.json({ ok: true });
});

app.post("/api/admin/raffle-payments/:orderId/reject", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  const res = rejectOrderByAdmin(orderId);
  if (!res.ok) return c.json({ error: res.error }, 400);
  return c.json({ ok: true });
});

app.get("/api/admin/raffles", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const rows = listRafflesAll();
  return c.json({
    raffles: rows.map((r) => raffleToDto(r)),
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
    ticket_count: v.ticket_count,
    collection_url: v.collection_url,
    collection_recipient: v.collection_recipient,
    qr_image_url: v.qr_image_url,
    status: v.status,
    sort_order: v.sort_order,
    wholesale_enabled: v.wholesale_enabled ? 1 : 0,
  });
  const row = getRaffleById(id);
  return c.json({ raffle: row ? raffleToDto(row) : null });
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
    ticket_count: v.ticket_count,
    collection_url: v.collection_url,
    collection_recipient: v.collection_recipient,
    qr_image_url: v.qr_image_url,
    status: v.status,
    sort_order: v.sort_order,
    wholesale_enabled: v.wholesale_enabled ? 1 : 0,
  });
  recalculateWholesaleForRaffle(id);
  const row = getRaffleById(id);
  return c.json({ raffle: row ? raffleToDto(row) : null });
});

app.delete("/api/admin/raffles/:id", (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const existing = getRaffleById(id);
  if (!existing) return c.json({ error: "Акция не найдена" }, 404);
  deleteRaffle(id);
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
    })),
    wholesalers: bundle.wholesalers,
  });
});

app.patch("/api/admin/users/:userId", async (c) => {
  const auth = requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  const target = getUserById(userId);
  if (!target) return c.json({ error: "Пользователь не найден" }, 404);
  let body: { name?: string; phone?: string; email?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const name = String(body.name ?? target.name).trim();
  const phoneRaw = body.phone !== undefined ? String(body.phone) : target.phone;
  const email = String(body.email ?? target.email).trim().toLowerCase();

  const phone = normalizePhone(phoneRaw);
  if (!phone) return c.json({ error: "Введите корректный телефон" }, 400);
  if (!isValidRuMobile(phone)) {
    return c.json({ error: "Нужен мобильный номер России (+7 9XX …)" }, 400);
  }
  if (!name) return c.json({ error: "Укажите имя" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Укажите корректный email" }, 400);
  }

  const existing = getUserByPhone(phone);
  if (existing && existing.id !== userId) {
    return c.json({ error: "Этот номер уже занят другим пользователем" }, 409);
  }
  const existingEmail = getUserByEmail(email);
  if (existingEmail && existingEmail.id !== userId) {
    return c.json({ error: "Этот email уже занят другим пользователем" }, 409);
  }

  updateUserProfile(userId, { name, phone, email });
  const updated = getUserById(userId);
  if (!updated) return c.json({ error: "Ошибка сохранения" }, 500);
  return c.json({
    user: {
      id: updated.id,
      phone: updated.phone,
      name: updated.name,
      email: updated.email,
      role: updated.role ?? "user",
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
  console.log(`HTTP + WebSocket ws://127.0.0.1:${PORT}/ws`);
  console.log(`SQLite: ./data/app.db`);
});
