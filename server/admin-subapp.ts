import "./load-env";
import { mkdirSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import type { SessionUser } from "./db.js";
import { getUserBySessionTokenPg } from "./db-auth-pg.js";
import {
  countActiveAdmins,
  deleteRaffle,
  getRaffleById,
  getSiteSettings,
  getSupportMessageById,
  getUserByEmail,
  getUserById,
  getUserByPhone,
  insertRaffle,
  insertSupportMessage,
  listAdminThreadsWithMeta,
  listRafflesAll,
  listSupportMessagesForUser,
  listUsersForAdminPage,
  listUsersForAdminPageByExactId,
  countUsersForAdmin,
  countUsersForAdminByExactId,
  countUsersForAdminBySearch,
  countConfirmedTicketsSoldByCenopad,
  getRaffleSalesAccounting,
  deleteUserAccountByAdmin,
  markThreadReadByStaff,
  messageToDto,
  searchAdminSupportThreads,
  setMaintenanceEnabled,
  updateRaffle,
  updateUserBlocked,
  updateUserProfile,
  updateUserRole,
  raffleToDto,
} from "./db.js";
import {
  adminAssignPhoneToExactTicket,
  adminBulkAssignPhoneLinesToRaffle,
  adminDetachParticipantTicket,
  adminFullyReleaseRaffleOrder,
  adminUserTicketsForPrimaryRaffle,
  listAdminRaffleParticipantsPage,
  listAdminRaffleWholesalers,
  listActiveOrdersForAdmin,
  countPaymentHistoryForAdmin,
  listPaymentHistoryForAdmin,
  listPendingPayments,
  listUserIdsWithConfirmedRaffleOrders,
  attachReceiptToOrder,
  buildRafflePaymentParticipationContext,
  confirmOrderByAdmin,
  getOrderById,
  getTicketNumbersForOrder,
  isRaffleTicketBlocked,
  listReceiptHistoryPriorForPendingOrder,
  orderToDto,
  recalculateRaffleDerivedStatsForRaffle,
  rejectOrderByAdmin,
} from "./raffle-orders.js";
import type {
  AdminActiveOrderRow,
  AdminPaymentHistoryRow,
  AdminRaffleParticipantView,
  PendingPaymentRow,
} from "./raffle-orders.js";
import {
  broadcastChatMessage,
  broadcastMaintenanceStatusUpdated,
  broadcastRaffleLaunchNotified,
  broadcastRafflesFeedUpdated,
  broadcastRaffleGridUpdated,
  broadcastRaffleTicketsUpdated,
  broadcastThreadReadByStaff,
  broadcastTypingStaffToUser,
} from "./ws-chat.js";
import { getStaffTypingForUser, getUserTypingForThread } from "./typing-state.js";
import { isValidRuMobile, normalizePhone } from "./phone.js";
import { extForChatMime, parseChatAttachmentFromMessage } from "./chat-attachments.js";
import {
  maybeSendRaffleLaunchEmails,
  notifyUserEmailStaffReply,
  notifyUserOrderFullyReleased,
  notifyUserReceiptRejectedRework,
} from "./notify-email.js";

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

function notifyRaffleGridMutated(raffleId: number | undefined | null): void {
  const r = Math.floor(Number(raffleId));
  if (Number.isFinite(r) && r > 0) broadcastRaffleGridUpdated(r);
}

const MAX_PRIVATE_CHAT_JOIN_URL =
  "https://max.ru/join/_vIVZ3_FIwNimrGLFBwVEDWR408uZ3uynFc336CYX2k";

function buildStaffRaffleReceiptConfirmedChatBody(
  raffleTitle: string,
  paidTicketNumbers: number[],
  bonusTicketNumbers: number[],
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
    ? `\n\n🎁 По акции 5+1 дополнительно закреплены бонусные номерки: ${bonusHuman}.`
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

function buildStaffMaxPrivateInviteOnlyChatBody(): string {
  return (
    `Если вас ещё нет в нашем приватном чате в MAX, вы можете присоединиться по кнопке ниже.\n` +
    MAX_PRIVATE_CHAT_JOIN_URL
  );
}

function buildStaffReceiptRejectedChatBody(
  raffleId: number,
  raffleTitle: string,
  adminNote: string,
): string {
  const safeTitle = String(raffleTitle || "акция")
    .trim()
    .slice(0, 180);
  const reason = String(adminNote || "")
    .trim()
    .slice(0, 500);
  const retryUrl = `${publicAppOrigin()}/home/raffle?id=${encodeURIComponent(String(raffleId))}&openPayment=1`;
  const payload = {
    kind: "receipt_rejected",
    title: safeTitle,
    reason: reason || "Причина не указана. Попробуйте загрузить более читаемый чек.",
    retry_url: retryUrl,
    cta: "Повторить оплату",
  };
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return (
    `Чек по акции «${safeTitle}» отклонён.\n` +
    `Причина: ${payload.reason}\n` +
    `Нажмите «Повторить оплату», чтобы отправить новый чек.` +
    `\n\n[[AB_CARD:${encoded}]]`
  );
}

function publicAppOrigin(): string {
  const u = process.env.APP_PUBLIC_URL?.trim() || process.env.SITE_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://127.0.0.1:4321";
}

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

async function authUser(c: Context): Promise<SessionUser | null> {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return (await getUserBySessionTokenPg(token)) ?? null;
}

function isBlockedUser(u: SessionUser): boolean {
  return u.blocked === 1;
}

async function requireAdmin(c: Context): Promise<SessionUser | Response> {
  const u = await authUser(c);
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

function normalizeRaffleStatus(s: string): "active" | "closed" | "paused" {
  if (s === "closed" || s === "paused") return s;
  return "active";
}

type RaffleInput = {
  title: string;
  cover_image_url: string;
  price_rub: number;
  cenopad_enabled: boolean;
  cenopad_price_rub: number;
  cenopad_start_at: number | null;
  cenopad_end_at: number | null;
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
  live_stream_note: string;
  live_stream_url: string;
  live_stream_at: number | null;
  live_stream_status: "scheduled" | "live" | "ended";
  status: "active" | "closed" | "paused";
  sort_order: number;
  wholesale_enabled: boolean;
  promo_5_plus_1_enabled: boolean;
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
  const cenopad_enabled = Boolean(body.cenopad_enabled);
  const cenopadPriceRaw = body.cenopad_price_rub;
  const cenopad_price_rub =
    cenopadPriceRaw === undefined || cenopadPriceRaw === null || cenopadPriceRaw === ""
      ? 0
      : Math.floor(Number(cenopadPriceRaw));
  const ticket_count = Math.floor(Number(body.ticket_count));
  if (!Number.isFinite(price_rub) || price_rub < 0 || price_rub > 1_000_000_000) {
    return { ok: false, error: "Некорректная цена билета" };
  }
  if (!Number.isFinite(old_price_rub) || old_price_rub < 0 || old_price_rub > 1_000_000_000) {
    return { ok: false, error: "Некорректная старая цена" };
  }
  if (!Number.isFinite(cenopad_price_rub) || cenopad_price_rub < 0 || cenopad_price_rub > 1_000_000_000) {
    return { ok: false, error: "Некорректная вторая цена" };
  }
  if (cenopad_enabled && cenopad_price_rub < 1) {
    return { ok: false, error: "Укажите вторую цену больше 0" };
  }
  if (cenopad_enabled && cenopad_price_rub >= price_rub) {
    return { ok: false, error: "Вторая цена должна быть ниже основной" };
  }
  const cenopadStartRaw = body.cenopad_start_at;
  const cenopadEndRaw = body.cenopad_end_at;
  const cenopad_start_at =
    cenopadStartRaw === undefined || cenopadStartRaw === null || cenopadStartRaw === ""
      ? null
      : Math.floor(Number(cenopadStartRaw));
  const cenopad_end_at =
    cenopadEndRaw === undefined || cenopadEndRaw === null || cenopadEndRaw === ""
      ? null
      : Math.floor(Number(cenopadEndRaw));
  if (cenopad_start_at != null && (!Number.isFinite(cenopad_start_at) || cenopad_start_at <= 0)) {
    return { ok: false, error: "Некорректное время старта второй цены" };
  }
  if (cenopad_end_at != null && (!Number.isFinite(cenopad_end_at) || cenopad_end_at <= 0)) {
    return { ok: false, error: "Некорректное время окончания второй цены" };
  }
  if (cenopad_start_at != null && cenopad_end_at != null && cenopad_end_at <= cenopad_start_at) {
    return { ok: false, error: "Окончание второй цены должно быть позже старта" };
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
  const promo_5_plus_1_enabled = Boolean(body.promo_5_plus_1_enabled);
  const hidden_from_public = Boolean(body.hidden_from_public);

  let rules_url = String(body.rules_url ?? "").trim();
  if (rules_url.length > 2000) return { ok: false, error: "Ссылка на правила слишком длинная" };
  if (rules_url && !/^https?:\/\//i.test(rules_url)) {
    return { ok: false, error: "Правила акции: укажите URL с http:// или https://" };
  }
  const live_stream_note = String(body.live_stream_note ?? "").trim().slice(0, 2000);
  const live_stream_url = String(body.live_stream_url ?? "").trim();
  const liveStreamAtRaw = body.live_stream_at;
  const live_stream_at =
    liveStreamAtRaw === undefined || liveStreamAtRaw === null || liveStreamAtRaw === ""
      ? null
      : Math.floor(Number(liveStreamAtRaw));
  if (live_stream_at != null && (!Number.isFinite(live_stream_at) || live_stream_at <= 0)) {
    return { ok: false, error: "Время эфира задано некорректно" };
  }
  const streamStatusRaw = String(body.live_stream_status ?? "scheduled")
    .trim()
    .toLowerCase();
  const live_stream_status =
    streamStatusRaw === "live" || streamStatusRaw === "ended" ? streamStatusRaw : "scheduled";
  if (live_stream_url.length > 2000) {
    return { ok: false, error: "Ссылка на эфир слишком длинная" };
  }
  if (live_stream_url && !/^https?:\/\//i.test(live_stream_url)) {
    return { ok: false, error: "Ссылка на эфир: укажите URL с http:// или https://" };
  }

  return {
    ok: true,
    value: {
      title,
      cover_image_url,
      price_rub,
      cenopad_enabled,
      cenopad_price_rub,
      cenopad_start_at,
      cenopad_end_at,
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
      live_stream_note,
      live_stream_url,
      live_stream_at,
      live_stream_status,
      status,
      sort_order,
      wholesale_enabled,
      promo_5_plus_1_enabled,
      hidden_from_public,
    },
  };
}

export const adminSubApp = new Hono().basePath("/api/admin");

adminSubApp.post("/chat/upload", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  return handleChatFileUpload(c);
});

adminSubApp.get("/settings", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  return c.json(await getSiteSettings());
});

adminSubApp.patch("/settings", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  let body: { maintenance_enabled?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const enabled = Boolean(body.maintenance_enabled);
  await setMaintenanceEnabled(enabled);
  broadcastMaintenanceStatusUpdated(enabled);
  c.header("Cache-Control", "no-store");
  return c.json(await getSiteSettings());
});

adminSubApp.get("/users", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const threadSearch = String(c.req.query("search") ?? c.req.query("thread_q") ?? "").trim();
  const list = threadSearch ? await searchAdminSupportThreads(threadSearch) : await listAdminThreadsWithMeta();
  return c.json({
    users: list.map((x) => ({
      id: x.id,
      phone: x.phone,
      name: x.name,
      email: x.email,
      locality: x.locality,
      role: x.role,
      blocked: x.blocked === 1,
      last_body: x.last_body,
      last_at: x.last_at,
      last_is_staff: x.last_is_staff,
      unread_count: x.unread_count,
    })),
  });
});

adminSubApp.get("/users/all", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const rawOff = c.req.query("offset");
  const rawLim = c.req.query("limit");
  const q = String(c.req.query("q") ?? "").trim();
  const rawFilterId = String(c.req.query("id") ?? "").trim();
  const offset = Number(rawOff ?? "0");
  const limit = Number(rawLim ?? "10");
  const safeOff = Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  const safeLim = Number.isFinite(limit) ? Math.min(Math.max(1, Math.floor(limit)), 100) : 10;
  let filterById: number | null = null;
  if (/^\d+$/.test(rawFilterId)) {
    const n = Number(rawFilterId);
    if (n > 0 && Number.isSafeInteger(n)) filterById = n;
  }
  const rows =
    filterById != null
      ? await listUsersForAdminPageByExactId(filterById, safeOff, safeLim)
      : await listUsersForAdminPage(safeOff, safeLim, q || null);
  const total =
    filterById != null ? await countUsersForAdminByExactId(filterById) : q ? await countUsersForAdminBySearch(q) : await countUsersForAdmin();
  return c.json({
    users: rows.map((x) => ({
      id: x.id,
      phone: x.phone,
      name: x.name,
      email: x.email,
      locality: x.locality,
      role: x.role,
      blocked: x.blocked === 1,
      created_at: x.created_at,
      last_active_at: x.last_active_at ?? null,
    })),
    total,
    offset: safeOff,
    limit: safeLim,
  });
});

adminSubApp.get("/users/:userId/messages", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  const target = await getUserById(userId);
  if (!target) return c.json({ error: "Пользователь не найден" }, 404);
  await markThreadReadByStaff(userId);
  broadcastThreadReadByStaff(userId);
  const rows = await listSupportMessagesForUser(userId);
  return c.json({
    user: {
      id: target.id,
      phone: target.phone,
      name: target.name,
      email:
        target.email != null && String(target.email).trim()
          ? String(target.email).trim().toLowerCase()
          : "",
      locality: target.locality != null ? String(target.locality).trim() : "",
      role: target.role ?? "user",
      blocked: target.blocked === 1,
      last_active_at: target.last_active_at ?? null,
    },
    messages: rows.map((r) => messageToDto(r)),
    user_typing: getUserTypingForThread(userId),
  });
});

adminSubApp.get("/users/:userId/latest-raffle-tickets", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  if (!(await getUserById(userId))) return c.json({ error: "Пользователь не найден" }, 404);
  c.header("Cache-Control", "no-store");
  const payload = await adminUserTicketsForPrimaryRaffle(userId);
  return c.json(payload);
});

adminSubApp.get("/users/:userId/typing", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  c.header("Cache-Control", "no-store");
  return c.json({
    user_typing: getUserTypingForThread(userId),
  });
});

adminSubApp.post("/typing", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  let body: { userId?: number; active?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const targetId = Number(body.userId);
  if (!Number.isFinite(targetId)) return c.json({ error: "Некорректный id" }, 400);
  if (!(await getUserById(targetId))) return c.json({ error: "Пользователь не найден" }, 404);
  broadcastTypingStaffToUser(targetId, Boolean(body.active));
  return c.json({ ok: true });
});

adminSubApp.post("/broadcast-max-chat-invite", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  if (!rateLimitAllow(`post:broadcast-max:${auth.id}`, 2, 120_000)) {
    return rateLimitExceeded(c);
  }
  const userIds = await listUserIdsWithConfirmedRaffleOrders();
  if (!userIds.length) {
    return c.json({ ok: true, sent: 0, total: 0, message: "Нет пользователей с закреплёнными оплатами" });
  }
  const body = buildStaffMaxPrivateInviteOnlyChatBody();
  let sent = 0;
  const errors: string[] = [];
  for (const uid of userIds) {
    try {
      const msgId = await insertSupportMessage(uid, body, true, null);
      await markThreadReadByStaff(uid);
      broadcastThreadReadByStaff(uid);
      const row = await getSupportMessageById(msgId);
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

adminSubApp.get("/raffle-payments", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const rows = await listPendingPayments();
  const active = await listActiveOrdersForAdmin();
  const historyTotal = await countPaymentHistoryForAdmin();
  const historyPageSize = 10;
  const historyBatch = await listPaymentHistoryForAdmin(historyPageSize + 1, 0);
  const history = historyBatch.slice(0, historyPageSize);
  const historyHasMore = historyBatch.length > historyPageSize;
  return c.json({
    server_time_ms: Date.now(),
    payments: await Promise.all(
      rows.map(async (row: PendingPaymentRow) => ({
        ...orderToDto(row),
        raffle_title: row.raffle_title,
        user_phone: row.user_phone,
        user_name: row.user_name,
        user_id: row.user_id,
        receipt_history_prior: await listReceiptHistoryPriorForPendingOrder(
          row.user_id,
          row.raffle_id,
          row.id,
          row.receipt_url,
        ),
      })),
    ),
    active_orders: active.map((row: AdminActiveOrderRow) => ({
      ...orderToDto(row),
      raffle_title: row.raffle_title,
      user_phone: row.user_phone,
      user_name: row.user_name,
      user_id: row.user_id,
    })),
    history: history.map((row: AdminPaymentHistoryRow) => ({
      ...orderToDto(row),
      raffle_title: row.raffle_title,
      user_phone: row.user_phone,
      user_name: row.user_name,
      user_id: row.user_id,
      ticket_numbers: row.ticket_numbers,
      receipt_history: row.receipt_history,
    })),
    history_page_size: historyPageSize,
    history_next_offset: history.length,
    history_has_more: historyHasMore,
    history_total: historyTotal,
  });
});

adminSubApp.get("/raffle-payments/history", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const rawLimit = Number(c.req.query("limit") ?? 10);
  const rawOffset = Number(c.req.query("offset") ?? 0);
  const limit = Math.max(1, Math.min(100, Math.floor(rawLimit || 10)));
  const offset = Math.max(0, Math.floor(rawOffset || 0));
  const batch = await listPaymentHistoryForAdmin(limit + 1, offset);
  const rows = batch.slice(0, limit);
  const hasMore = batch.length > limit;
  return c.json({
    history: rows.map((row: AdminPaymentHistoryRow) => ({
      ...orderToDto(row),
      raffle_title: row.raffle_title,
      user_phone: row.user_phone,
      user_name: row.user_name,
      user_id: row.user_id,
      ticket_numbers: row.ticket_numbers,
      receipt_history: row.receipt_history,
    })),
    next_offset: offset + rows.length,
    has_more: hasMore,
  });
});

adminSubApp.post("/raffle-payments/:orderId/confirm", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const orderId = Number(c.req.param("orderId"));
  if (!Number.isFinite(orderId)) return c.json({ error: "Некорректный id" }, 400);
  const owner = (await listPendingPayments()).find((p: PendingPaymentRow) => Number(p.id) === orderId);
  const ticketNumsBefore = await getTicketNumbersForOrder(orderId);
  const res = await confirmOrderByAdmin(orderId);
  if (!res.ok) return c.json({ error: "error" in res ? res.error : "Ошибка" }, 400);
  const ticketNumsAfter = await getTicketNumbersForOrder(orderId);
  const beforeSet = new Set(ticketNumsBefore.map((n) => Math.floor(Number(n))));
  const bonusNums = ticketNumsAfter.filter((n) => !beforeSet.has(Math.floor(Number(n))));
  if (owner && Number.isFinite(Number(owner.user_id))) {
    const uid = Number(owner.user_id);
    try {
      const title = String(owner.raffle_title ?? "").trim() || "Акция";
      const body = buildStaffRaffleReceiptConfirmedChatBody(title, ticketNumsBefore, bonusNums);
      const msgId = await insertSupportMessage(uid, body, true, null);
      await markThreadReadByStaff(uid);
      broadcastThreadReadByStaff(uid);
      const row = await getSupportMessageById(msgId);
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

adminSubApp.post("/raffle-payments/:orderId/reject", async (c) => {
  const auth = await requireAdmin(c);
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
  const pendingRow = (await listPendingPayments()).find((p: PendingPaymentRow) => Number(p.id) === orderId);
  const res = await rejectOrderByAdmin(orderId, { adminNote });
  if (!res.ok) return c.json({ error: "error" in res ? res.error : "Ошибка" }, 400);
  if (pendingRow && Number.isFinite(Number(pendingRow.user_id))) {
    const uid = Number(pendingRow.user_id);
    const updated = await getOrderById(orderId);
    const raffle = await getRaffleById(pendingRow.raffle_id);
    const tok = updated ? String((updated as { public_status_token?: string }).public_status_token ?? "").trim() : "";
    const statusPageUrl = tok
      ? `${publicAppOrigin()}/home/order-status?t=${encodeURIComponent(tok)}`
      : "";
    const rulesUrl = raffle ? String(raffle.rules_url ?? "").trim() : "";
    if (updated && raffle) {
      if (res.mode === "rework") {
        try {
          const body = buildStaffReceiptRejectedChatBody(raffle.id, raffle.title, adminNote);
          const msgId = await insertSupportMessage(uid, body, true, null);
          await markThreadReadByStaff(uid);
          broadcastThreadReadByStaff(uid);
          const row = await getSupportMessageById(msgId);
          if (row) broadcastChatMessage(uid, messageToDto(row));
        } catch (e) {
          console.error(
            "[admin/raffle-payments reject] chat notify:",
            e instanceof Error ? e.message : e,
          );
        }
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

adminSubApp.post("/raffle-orders/:orderId/release", async (c) => {
  const auth = await requireAdmin(c);
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
  const before = await getOrderById(orderId);
  const res = await adminFullyReleaseRaffleOrder(orderId, adminNote || null);
  if (!res.ok) return c.json({ error: "error" in res ? res.error : "Ошибка" }, 400);
  if (before && Number.isFinite(Number(before.user_id))) {
    const uid = Number(before.user_id);
    const raffle = await getRaffleById(before.raffle_id);
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

adminSubApp.get("/raffles", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const rows = await listRafflesAll();
  return c.json({
    raffles: await Promise.all(
      rows.map(async (r) => {
        const soldBySecond = await countConfirmedTicketsSoldByCenopad(r.id);
        const accounting = await getRaffleSalesAccounting(r.id);
        return {
          ...raffleToDto(r, { forAdmin: true }),
          cenopad_sold_count: soldBySecond,
          sales_accounting: accounting,
        };
      }),
    ),
  });
});

adminSubApp.post("/raffles/upload", async (c) => {
  const auth = await requireAdmin(c);
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

adminSubApp.post("/raffles", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const parsed = parseRaffleBody(body);
  if (!parsed.ok) {
    return c.json({ error: "error" in parsed ? parsed.error : "Некорректные данные" }, 400);
  }
  const v = parsed.value;
  const id = await insertRaffle({
    title: v.title,
    cover_image_url: v.cover_image_url,
    price_rub: v.price_rub,
    cenopad_enabled: v.cenopad_enabled ? 1 : 0,
    cenopad_price_rub: v.cenopad_price_rub,
    cenopad_start_at: v.cenopad_start_at,
    cenopad_end_at: v.cenopad_end_at,
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
    live_stream_note: v.live_stream_note,
    live_stream_url: v.live_stream_url,
    live_stream_at: v.live_stream_at,
    live_stream_status: v.live_stream_status,
    status: v.status,
    sort_order: v.sort_order,
    wholesale_enabled: v.wholesale_enabled ? 1 : 0,
    promo_5_plus_1_enabled: v.promo_5_plus_1_enabled ? 1 : 0,
    hidden_from_public: v.hidden_from_public ? 1 : 0,
  });
  void maybeSendRaffleLaunchEmails(id).catch((e) =>
    console.error("[admin/raffles POST] notify:", e instanceof Error ? e.message : e),
  );
  broadcastRafflesFeedUpdated();
  const row = await getRaffleById(id);
  return c.json({ raffle: row ? raffleToDto(row, { forAdmin: true }) : null });
});

adminSubApp.patch("/raffles/:id", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const existing = await getRaffleById(id);
  if (!existing) return c.json({ error: "Акция не найдена" }, 404);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const parsed = parseRaffleBody(body);
  if (!parsed.ok) {
    return c.json({ error: "error" in parsed ? parsed.error : "Некорректные данные" }, 400);
  }
  const v = parsed.value;
  await updateRaffle(id, {
    title: v.title,
    cover_image_url: v.cover_image_url,
    price_rub: v.price_rub,
    cenopad_enabled: v.cenopad_enabled ? 1 : 0,
    cenopad_price_rub: v.cenopad_price_rub,
    cenopad_start_at: v.cenopad_start_at,
    cenopad_end_at: v.cenopad_end_at,
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
    live_stream_note: v.live_stream_note,
    live_stream_url: v.live_stream_url,
    live_stream_at: v.live_stream_at,
    live_stream_status: v.live_stream_status,
    status: v.status,
    sort_order: v.sort_order,
    wholesale_enabled: v.wholesale_enabled ? 1 : 0,
    promo_5_plus_1_enabled: v.promo_5_plus_1_enabled ? 1 : 0,
    hidden_from_public: v.hidden_from_public ? 1 : 0,
  });
  await recalculateRaffleDerivedStatsForRaffle(id);
  void maybeSendRaffleLaunchEmails(id).catch((e) =>
    console.error("[admin/raffles PATCH] notify:", e instanceof Error ? e.message : e),
  );
  broadcastRafflesFeedUpdated();
  const row = await getRaffleById(id);
  return c.json({ raffle: row ? raffleToDto(row, { forAdmin: true }) : null });
});

adminSubApp.post("/raffles/:id/notify-launch", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const row = await getRaffleById(id);
  if (!row) return c.json({ error: "Акция не найдена" }, 404);
  broadcastRaffleLaunchNotified(id);
  return c.json({ ok: true });
});

adminSubApp.delete("/raffles/:id", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const existing = await getRaffleById(id);
  if (!existing) return c.json({ error: "Акция не найдена" }, 404);
  await deleteRaffle(id);
  broadcastRafflesFeedUpdated();
  return c.json({ ok: true });
});

adminSubApp.get("/raffles/:id/participants", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = await getRaffleById(id);
  if (!raffle) return c.json({ error: "Акция не найдена" }, 404);
  const rawOffset = Number(c.req.query("offset") ?? "0");
  const rawLimit = Number(c.req.query("limit") ?? "120");
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.floor(rawLimit)), 500) : 120;
  const q = String(c.req.query("q") ?? "");
  const includeWholesalers = String(c.req.query("include_wholesalers") ?? "1") !== "0";
  c.header("Cache-Control", "no-store");
  const page = await listAdminRaffleParticipantsPage(id, { offset, limit, search: q });
  const wholesalers = includeWholesalers ? await listAdminRaffleWholesalers(id) : [];
  return c.json({
    wholesale_enabled: page.wholesale_enabled,
    participants: page.participants.map((row: AdminRaffleParticipantView) => ({
      ticket_number: row.ticket_number,
      user_phone: row.user_phone,
      order_status: row.order_status,
      is_wholesale: row.is_wholesale,
      user_id: row.user_id,
      user_name: row.user_name,
      user_email: row.user_email,
      user_locality: row.user_locality,
    })),
    wholesalers,
    total: page.total,
    offset,
    limit,
    has_more: offset + page.participants.length < page.total,
  });
});

adminSubApp.get("/raffles/:id/tickets/:ticketNumber/availability", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = await getRaffleById(id);
  if (!raffle) return c.json({ error: "Акция не найдена" }, 404);
  const ticketNumber = Number(c.req.param("ticketNumber"));
  const n = Math.floor(ticketNumber);
  if (!Number.isFinite(n) || n < 1 || n > raffle.ticket_count) {
    return c.json({ error: "Некорректный номерок" }, 400);
  }
  const is_free = !await isRaffleTicketBlocked(id, n);
  return c.json({ ticket_number: n, is_free });
});

adminSubApp.post("/raffles/:id/bulk-assign-phones", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = await getRaffleById(id);
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
  const r = await adminBulkAssignPhoneLinesToRaffle(id, lines, startNum);
  if (!r.ok) return c.json({ error: "error" in r ? r.error : "Ошибка" }, 400);
  if (r.assigned > 0) notifyRaffleGridMutated(id);
  if (Array.isArray(r.affected_user_ids)) {
    for (const uid of r.affected_user_ids) {
      if (Number.isFinite(uid) && uid > 0) broadcastRaffleTicketsUpdated(uid);
    }
  }
  return c.json({ assigned: r.assigned, skipped: r.skipped });
});

adminSubApp.post("/raffles/:id/assign-phone-ticket", async (c) => {
  const auth = await requireAdmin(c);
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
  const res = await adminAssignPhoneToExactTicket(id, phone, ticket_number);
  if (!res.ok) return c.json({ error: "error" in res ? res.error : "Ошибка" }, 400);
  notifyRaffleGridMutated(id);
  if (res.affected_user_id != null) broadcastRaffleTicketsUpdated(res.affected_user_id);
  return c.json({ ok: true });
});

adminSubApp.delete("/raffles/:id/participant-tickets/:ticketNumber", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  const ticketNumber = Number(c.req.param("ticketNumber"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  if (!Number.isFinite(ticketNumber)) return c.json({ error: "Некорректный номерок" }, 400);
  const raffle = await getRaffleById(id);
  if (!raffle) return c.json({ error: "Акция не найдена" }, 404);
  const r = await adminDetachParticipantTicket(id, ticketNumber);
  if (!r.ok) return c.json({ error: "error" in r ? r.error : "Ошибка" }, 400);
  notifyRaffleGridMutated(id);
  if (r.affected_user_id != null) broadcastRaffleTicketsUpdated(r.affected_user_id);
  return c.json({ ok: true });
});

adminSubApp.patch("/users/:userId", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  const target = await getUserById(userId);
  if (!target) return c.json({ error: "Пользователь не найден" }, 404);
  let body: { name?: string; phone?: string; email?: string; locality?: string; role?: string; blocked?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }

  const wantsProfile =
    body.name !== undefined || body.phone !== undefined || body.email !== undefined || body.locality !== undefined;

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
    const locality = body.locality !== undefined
      ? String(body.locality).trim()
      : target.locality != null
        ? String(target.locality).trim()
        : "";
    if (!locality) return c.json({ error: "Укажите населенный пункт" }, 400);

    const existing = await getUserByPhone(phone);
    if (existing && existing.id !== userId) {
      return c.json({ error: "Этот номер уже занят другим пользователем" }, 409);
    }
    if (emailFinal) {
      const existingEmail = await getUserByEmail(emailFinal);
      if (existingEmail && existingEmail.id !== userId) {
        return c.json({ error: "Этот email уже занят другим пользователем" }, 409);
      }
    }

    await updateUserProfile(userId, { name, phone, email: emailFinal, locality });
  }

  if (body.role !== undefined) {
    const role = String(body.role).toLowerCase() === "admin" ? "admin" : "user";
    const wasAdmin = (target.role ?? "user") === "admin";
    if (role === "user" && wasAdmin && await countActiveAdmins() === 1) {
      return c.json({ error: "Нельзя снять последнего администратора" }, 400);
    }
    await updateUserRole(userId, role);
  }

  if (body.blocked !== undefined) {
    const blocked = Boolean(body.blocked) ? 1 : 0;
    if (blocked === 1) {
      if (userId === auth.id) {
        return c.json({ error: "Нельзя заблокировать собственный аккаунт" }, 400);
      }
      const t2 = await getUserById(userId);
      if (t2 && (t2.role ?? "user") === "admin" && await countActiveAdmins() === 1) {
        return c.json({ error: "Нельзя заблокировать последнего администратора" }, 400);
      }
    }
    await updateUserBlocked(userId, blocked);
  }

  const updated = await getUserById(userId);
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
      locality: updated.locality != null ? String(updated.locality).trim() : "",
      role: updated.role ?? "user",
      blocked: updated.blocked === 1,
    },
  });
});

adminSubApp.post("/users/:userId/messages", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  const target = await getUserById(userId);
  if (!target) return c.json({ error: "Пользователь не найден" }, 404);
  let body: { body?: string; attachment?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const parsed = parseChatMessagePayload(body);
  if (!parsed.ok) {
    return c.json({ error: "error" in parsed ? parsed.error : "Некорректные данные" }, 400);
  }
  const id = await insertSupportMessage(userId, parsed.text, true, parsed.attachment);
  await markThreadReadByStaff(userId);
  broadcastThreadReadByStaff(userId);
  const row = await getSupportMessageById(id);
  if (row) broadcastChatMessage(userId, messageToDto(row));
  notifyUserEmailStaffReply(userId, {
    body: parsed.text,
    attachmentName: parsed.attachment?.name ?? null,
    attachmentMime: parsed.attachment?.mime ?? null,
  });
  const rows = await listSupportMessagesForUser(userId);
  return c.json({
    messages: rows.map((r) => messageToDto(r)),
  });
});

adminSubApp.delete("/users/:userId", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) return c.json({ error: "Некорректный id" }, 400);
  const target = await getUserById(userId);
  if (!target) return c.json({ error: "Пользователь не найден" }, 404);
  if (userId === auth.id) {
    return c.json({ error: "Нельзя удалить собственный аккаунт" }, 400);
  }
  if ((target.role ?? "user") === "admin" && await countActiveAdmins() === 1) {
    return c.json({ error: "Нельзя удалить последнего администратора" }, 400);
  }
  await deleteUserAccountByAdmin(userId);
  return c.json({ ok: true });
});
