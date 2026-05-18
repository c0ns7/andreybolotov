import "./load-env";
import { mkdirSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import bcrypt from "bcryptjs";
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
  deleteSupportStaffMessageForUser,
  getRaffleSalesAccounting,
  getAdminUsersStats,
  deletePasswordResetTokensForUser,
  deleteUserAccountByAdmin,
  markThreadReadByStaff,
  messageToDto,
  searchAdminSupportThreads,
  setMaintenanceEnabled,
  updateRaffle,
  updateUserBlocked,
  updateUserPasswordHash,
  updateUserProfile,
  updateUserRole,
  raffleToDto,
} from "./db.js";
import {
  adminAssignPhoneToExactTicket,
  adminBulkAssignFromSourceRaffleTickets,
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
  listGloballyFreeTicketNumbers,
  listReceiptHistoryPriorForPendingOrder,
  orderToDto,
  recalculateRaffleDerivedStatsForRaffle,
  rejectOrderByAdmin,
  raffleMaxRejectReworksFromEnv,
} from "./raffle-orders.js";
import {
  createBlogPost,
  deleteBlogPost,
  getBlogPostById,
  listAllBlogTags,
  listBlogPosts,
  updateBlogPost,
} from "./blog.js";
import {
  createPrizeAward,
  getPrizeAwardById,
  listPrizeAwardsForAdmin,
  prizeAwardToDto,
  prizeAwardToDtoAsync,
  updatePrizeAwardAdmin,
} from "./prizes.js";
import type {
  AdminActiveOrderRow,
  AdminPaymentHistoryRow,
  AdminRaffleParticipantView,
  PendingPaymentRow,
} from "./raffle-orders.js";
import { listBankCardsWithAdminStats, replaceRaffleBankCards, type RaffleBankCardInput } from "./raffle-bank-cards.js";
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
const blogUploadsDirs = ensureUploadDirs("blog");
const prizeUploadsDirs = ensureUploadDirs("prizes");

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

function buildStaffMaxPrivateInviteOnlyChatBody(): string {
  return (
    `Если вас ещё нет в нашем приватном чате в MAX, вы можете присоединиться по кнопке ниже.\n` +
    MAX_PRIVATE_CHAT_JOIN_URL
  );
}

function buildStaffAdminAssignedTicketsChatBody(
  raffleTitle: string,
  ticketNumbers: number[],
  adminNote?: string,
): string {
  const safeTitle = String(raffleTitle || "акция")
    .trim()
    .slice(0, 180);
  const nums = [
    ...new Set(
      ticketNumbers.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0),
    ),
  ].sort((a, b) => a - b);
  let head: string;
  if (nums.length === 0) {
    head = `Вам закреплены номерки по акции «${safeTitle}».`;
  } else if (nums.length === 1) {
    head = `Вам закреплён номерок №${nums[0]} по акции «${safeTitle}».`;
  } else {
    head =
      `Вам закреплены номерки ` + nums.map((n) => `№${n}`).join(", ") + ` по акции «${safeTitle}».`;
  }
  const note = String(adminNote ?? "").trim().slice(0, 500);
  if (!note) return head;
  return `${head}\n\n${note}`;
}

async function sendAdminTicketAssignmentNotifications(
  userId: number,
  targetRaffleTitle: string,
  ticketNumbers: number[],
  adminNote: string,
): Promise<void> {
  const trimmed = String(adminNote ?? "").trim().slice(0, 500);
  const chatBody = buildStaffAdminAssignedTicketsChatBody(
    targetRaffleTitle,
    ticketNumbers,
    trimmed || undefined,
  );
  const msgId = await insertSupportMessage(userId, chatBody, true, null);
  await markThreadReadByStaff(userId);
  broadcastThreadReadByStaff(userId);
  const row = await getSupportMessageById(msgId);
  if (row) broadcastChatMessage(userId, messageToDto(row));
  notifyUserEmailStaffReply(userId, { body: chatBody, attachmentName: null, attachmentMime: null });
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
  wholesale_every_n_tickets: number;
  promo_5_plus_1_enabled: boolean;
  promo_5_plus_2_enabled: boolean;
  hidden_from_public: boolean;
  card_payment_scope: "unlimited" | "wholesale_only" | "min_order_tickets";
  card_payment_min_tickets: number;
  bank_cards: RaffleBankCardInput[];
};

function parseBankCardsInput(
  raw: unknown,
): { ok: true; value: RaffleBankCardInput[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "bank_cards: укажите массив" };
  const out: RaffleBankCardInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const idRaw = o.id;
    const id = idRaw === undefined || idRaw === null || idRaw === "" ? undefined : Math.floor(Number(idRaw));
    const card_number = String(o.card_number ?? "").trim();
    const recipient = String(o.recipient ?? "").trim();
    if (!card_number && !recipient) continue;
    if (!card_number) return { ok: false, error: "У каждой карты укажите номер" };
    if (card_number.length > 64) return { ok: false, error: "Номер карты слишком длинный" };
    if (recipient.length > 500) return { ok: false, error: "Получатель слишком длинный" };
    const dailyRaw = o.daily_max_orders;
    const daily_max_orders =
      dailyRaw === undefined || dailyRaw === null || dailyRaw === "" ? 0 : Math.floor(Number(dailyRaw));
    if (!Number.isFinite(daily_max_orders) || daily_max_orders < 0 || daily_max_orders > 1_000_000) {
      return { ok: false, error: "Лимит операций в сутки: целое число от 0 (без лимита)" };
    }
    const duRaw = o.disabled_until_ms;
    const disabled_until_ms =
      duRaw === undefined || duRaw === null || duRaw === "" ? null : Math.floor(Number(duRaw));
    if (disabled_until_ms != null && (!Number.isFinite(disabled_until_ms) || disabled_until_ms < 0)) {
      return { ok: false, error: "Некорректное время отключения карты" };
    }
    const soRaw = o.sort_order;
    const sort_order =
      soRaw === undefined || soRaw === null || soRaw === "" ? out.length : Math.floor(Number(soRaw));
    out.push({
      id: id && id > 0 ? id : undefined,
      card_number,
      recipient,
      daily_max_orders,
      disabled_until_ms,
      sort_order: Number.isFinite(sort_order) ? sort_order : out.length,
    });
  }
  out.sort((a, b) => a.sort_order - b.sort_order);
  for (let i = 0; i < out.length; i++) out[i].sort_order = i;
  return { ok: true, value: out };
}

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
  const wholesaleNEveryRaw = body.wholesale_every_n_tickets;
  const wholesale_every_n_tickets =
    wholesaleNEveryRaw === undefined || wholesaleNEveryRaw === null || wholesaleNEveryRaw === ""
      ? 10
      : Math.floor(Number(wholesaleNEveryRaw));
  if (
    !Number.isFinite(wholesale_every_n_tickets) ||
    wholesale_every_n_tickets < 1 ||
    wholesale_every_n_tickets > 100_000_000
  ) {
    return { ok: false, error: "Укажите целое число от 1: сколько закреплённых номерков дают 1 номер оптовика" };
  }
  const promo_5_plus_1_enabled = Boolean(body.promo_5_plus_1_enabled);
  const promo_5_plus_2_enabled = Boolean(body.promo_5_plus_2_enabled);
  if (promo_5_plus_1_enabled && promo_5_plus_2_enabled) {
    return { ok: false, error: "Включите только одну акцию: 5+1 или 5+2." };
  }
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

  const scopeRaw = String(body.card_payment_scope ?? "unlimited").trim().toLowerCase();
  let card_payment_scope: "unlimited" | "wholesale_only" | "min_order_tickets" = "unlimited";
  if (scopeRaw === "wholesale_only") card_payment_scope = "wholesale_only";
  else if (scopeRaw === "min_order_tickets") card_payment_scope = "min_order_tickets";

  const minCardRaw = body.card_payment_min_tickets;
  const card_payment_min_tickets =
    minCardRaw === undefined || minCardRaw === null || minCardRaw === ""
      ? 2
      : Math.floor(Number(minCardRaw));
  if (!Number.isFinite(card_payment_min_tickets) || card_payment_min_tickets < 1 || card_payment_min_tickets > 100_000_000) {
    return { ok: false, error: "Минимум номерков для оплаты на карту: целое число от 1" };
  }

  const parsedCards = parseBankCardsInput(body.bank_cards);
  if (!parsedCards.ok) return parsedCards;

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
      wholesale_every_n_tickets,
      promo_5_plus_1_enabled,
      promo_5_plus_2_enabled,
      hidden_from_public,
      card_payment_scope,
      card_payment_min_tickets,
      bank_cards: parsedCards.value,
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

adminSubApp.get("/stats/users", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const stats = await getAdminUsersStats();
  return c.json(stats);
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
    receipt_reject_max: raffleMaxRejectReworksFromEnv(),
    payments: await Promise.all(
      rows.map(async (row: PendingPaymentRow) => ({
        ...orderToDto(row),
        raffle_title: row.raffle_title,
        user_phone: row.user_phone,
        user_name: row.user_name,
        user_id: row.user_id,
        ticket_numbers: await getTicketNumbersForOrder(row.id),
        receipt_mime: row.receipt_mime ?? null,
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
      const raffleRow = await getRaffleById(Number(owner.raffle_id));
      const bonusPromoLabel =
        bonusNums.length > 0 && Number(raffleRow?.promo_5_plus_2_enabled) === 1 ? "5+2" : "5+1";
      const body = buildStaffRaffleReceiptConfirmedChatBody(title, ticketNumsBefore, bonusNums, bonusPromoLabel);
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
        const bank_cards = await listBankCardsWithAdminStats(r.id, Date.now());
        return {
          ...raffleToDto(r, { forAdmin: true }),
          cenopad_sold_count: soldBySecond,
          sales_accounting: accounting,
          bank_cards,
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
    wholesale_every_n_tickets: v.wholesale_every_n_tickets,
    card_payment_scope: v.card_payment_scope,
    card_payment_min_tickets: v.card_payment_min_tickets,
    promo_5_plus_1_enabled: v.promo_5_plus_1_enabled ? 1 : 0,
    promo_5_plus_2_enabled: v.promo_5_plus_2_enabled ? 1 : 0,
    hidden_from_public: v.hidden_from_public ? 1 : 0,
  });
  await replaceRaffleBankCards(id, v.bank_cards);
  void maybeSendRaffleLaunchEmails(id).catch((e) =>
    console.error("[admin/raffles POST] notify:", e instanceof Error ? e.message : e),
  );
  broadcastRafflesFeedUpdated();
  const row = await getRaffleById(id);
  const dto = row ? raffleToDto(row, { forAdmin: true }) : null;
  const bank_cards = row ? await listBankCardsWithAdminStats(row.id, Date.now()) : [];
  return c.json({ raffle: dto ? { ...dto, bank_cards } : null });
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
    wholesale_every_n_tickets: v.wholesale_every_n_tickets,
    card_payment_scope: v.card_payment_scope,
    card_payment_min_tickets: v.card_payment_min_tickets,
    promo_5_plus_1_enabled: v.promo_5_plus_1_enabled ? 1 : 0,
    promo_5_plus_2_enabled: v.promo_5_plus_2_enabled ? 1 : 0,
    hidden_from_public: v.hidden_from_public ? 1 : 0,
  });
  await replaceRaffleBankCards(id, v.bank_cards);
  await recalculateRaffleDerivedStatsForRaffle(id);
  void maybeSendRaffleLaunchEmails(id).catch((e) =>
    console.error("[admin/raffles PATCH] notify:", e instanceof Error ? e.message : e),
  );
  broadcastRafflesFeedUpdated();
  const row = await getRaffleById(id);
  const dto = row ? raffleToDto(row, { forAdmin: true }) : null;
  const bank_cards = row ? await listBankCardsWithAdminStats(row.id, Date.now()) : [];
  return c.json({ raffle: dto ? { ...dto, bank_cards } : null });
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
    wholesale_every_n_tickets: page.wholesale_every_n_tickets,
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

adminSubApp.get("/raffles/:id/random-free-ticket", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = await getRaffleById(id);
  if (!raffle) return c.json({ error: "Акция не найдена" }, 404);
  const free = await listGloballyFreeTicketNumbers(id);
  if (!free.length) return c.json({ error: "Нет свободных номерков" }, 404);
  const ticket_number = free[Math.floor(Math.random() * free.length)]!;
  return c.json({ ticket_number, free_count: free.length });
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

adminSubApp.post("/raffles/:id/bulk-assign-legacy-winners", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const raffle = await getRaffleById(id);
  if (!raffle) return c.json({ error: "Акция не найдена" }, 404);
  let body: {
    source_raffle_id?: unknown;
    source_ticket_numbers?: unknown;
    start_number?: unknown;
    admin_note?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const sourceId = Math.floor(Number(body.source_raffle_id));
  if (!Number.isFinite(sourceId) || sourceId < 1) {
    return c.json({ error: "Выберите акцию-источник" }, 400);
  }
  const rawNums = body.source_ticket_numbers;
  let sourceTicketNumbers: number[] = [];
  if (Array.isArray(rawNums)) {
    sourceTicketNumbers = rawNums
      .map((x) => Math.floor(Number(x)))
      .filter((n) => Number.isFinite(n));
  } else {
    const s = String(rawNums ?? "").trim();
    if (s) {
      sourceTicketNumbers = s
        .split(/[,;\s]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => Math.floor(Number(p)))
        .filter((n) => Number.isFinite(n));
    }
  }
  if (sourceTicketNumbers.length === 0) {
    return c.json({ error: "Укажите номерки из акции-источника (через запятую)" }, 400);
  }
  const startNum =
    body.start_number === undefined || body.start_number === null || body.start_number === ""
      ? 1
      : Math.floor(Number(body.start_number));
  const admin_note =
    body.admin_note === undefined || body.admin_note === null
      ? ""
      : String(body.admin_note).trim().slice(0, 500);
  const r = await adminBulkAssignFromSourceRaffleTickets(id, sourceId, sourceTicketNumbers, startNum);
  if (!r.ok) return c.json({ error: "error" in r ? r.error : "Ошибка" }, 400);
  if (r.assigned > 0) notifyRaffleGridMutated(id);
  if (Array.isArray(r.affected_user_ids)) {
    for (const uid of r.affected_user_ids) {
      if (Number.isFinite(uid) && uid > 0) broadcastRaffleTicketsUpdated(uid);
    }
  }
  const title = String(raffle.title || "").trim();
  for (const t of r.notify_targets) {
    if (!Number.isFinite(t.user_id) || t.user_id < 1 || !t.tickets.length) continue;
    try {
      await sendAdminTicketAssignmentNotifications(t.user_id, title, t.tickets, admin_note);
    } catch (e) {
      console.error(
        "[admin/bulk-assign-legacy-winners] notify user",
        t.user_id,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return c.json({ assigned: r.assigned, skipped: r.skipped });
});

adminSubApp.post("/raffles/:id/assign-phone-ticket", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  let body: { phone?: unknown; ticket_number?: unknown; admin_note?: unknown };
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
  const admin_note =
    body.admin_note === undefined || body.admin_note === null
      ? ""
      : String(body.admin_note).trim().slice(0, 500);
  const res = await adminAssignPhoneToExactTicket(id, phone, ticket_number);
  if (!res.ok) return c.json({ error: "error" in res ? res.error : "Ошибка" }, 400);
  notifyRaffleGridMutated(id);
  const uid = res.affected_user_id;
  if (uid != null && Number.isFinite(uid) && uid > 0) {
    broadcastRaffleTicketsUpdated(uid);
    try {
      const raffle = await getRaffleById(id);
      await sendAdminTicketAssignmentNotifications(
        uid,
        raffle ? raffle.title : "",
        [Math.floor(ticket_number)],
        admin_note,
      );
    } catch (e) {
      console.error(
        "[admin/assign-phone-ticket] notify:",
        e instanceof Error ? e.message : e,
      );
    }
  }
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
  let body: {
    name?: string;
    phone?: string;
    email?: string;
    locality?: string;
    role?: string;
    blocked?: boolean;
    new_password?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }

  const wantsProfile =
    body.name !== undefined || body.phone !== undefined || body.locality !== undefined;

  if (wantsProfile) {
    const name = String(body.name ?? target.name).trim();
    const phoneRaw = body.phone !== undefined ? String(body.phone) : target.phone;

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
    await updateUserProfile(userId, { name, phone, email: null, locality });
  }

  if (body.new_password !== undefined) {
    const raw = String(body.new_password ?? "").trim();
    if (raw.length > 0) {
      if (raw.length < 6) {
        return c.json({ error: "Пароль не короче 6 символов" }, 400);
      }
      const passwordHash = bcrypt.hashSync(raw, 10);
      await updateUserPasswordHash(userId, passwordHash);
      await deletePasswordResetTokensForUser(userId);
    }
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

adminSubApp.delete("/users/:userId/messages/:messageId", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const userId = Number(c.req.param("userId"));
  const messageId = Number(c.req.param("messageId"));
  if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(messageId) || messageId <= 0) {
    return c.json({ error: "Некорректные параметры" }, 400);
  }
  const target = await getUserById(userId);
  if (!target) return c.json({ error: "Пользователь не найден" }, 404);
  const ok = await deleteSupportStaffMessageForUser(userId, messageId);
  if (!ok) return c.json({ error: "Сообщение не найдено или удаление запрещено" }, 404);
  const rows = await listSupportMessagesForUser(userId);
  return c.json({ messages: rows.map((r) => messageToDto(r)) });
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

adminSubApp.get("/blog/tags", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const tags = await listAllBlogTags();
  return c.json({ tags });
});

adminSubApp.get("/blog/posts", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const sort = c.req.query("sort") === "popular" ? "popular" : "newest";
  const search = String(c.req.query("q") ?? "").trim();
  const tag = String(c.req.query("tag") ?? "").trim();
  const statusRaw = String(c.req.query("status") ?? "all");
  const status =
    statusRaw === "published" || statusRaw === "draft" ? statusRaw : "all";
  const limit = Number(c.req.query("limit") ?? 30);
  const offset = Number(c.req.query("offset") ?? 0);
  const data = await listBlogPosts({
    sort,
    search,
    tagSlug: tag,
    status,
    limit,
    offset,
    viewerUserId: auth.id,
  });
  return c.json(data);
});

adminSubApp.get("/blog/posts/:id", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const post = await getBlogPostById(id, auth.id);
  if (!post) return c.json({ error: "Не найдено" }, 404);
  return c.json({ post });
});

adminSubApp.post("/blog/posts", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const res = await createBlogPost(auth.id, {
    title: String(body.title ?? ""),
    excerpt: String(body.excerpt ?? ""),
    body_html: String(body.body_html ?? ""),
    cover_url: String(body.cover_url ?? ""),
    cover_mime: body.cover_mime != null ? String(body.cover_mime) : null,
    keywords: String(body.keywords ?? ""),
    status: body.status === "published" ? "published" : "draft",
    tag_labels: Array.isArray(body.tag_labels) ? body.tag_labels.map(String) : [],
    slug: body.slug != null ? String(body.slug) : undefined,
  });
  if (!res.ok) return c.json({ error: res.error }, 400);
  return c.json({ post: res.post });
});

adminSubApp.patch("/blog/posts/:id", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const res = await updateBlogPost(id, {
    title: String(body.title ?? ""),
    excerpt: String(body.excerpt ?? ""),
    body_html: String(body.body_html ?? ""),
    cover_url: body.cover_url != null ? String(body.cover_url) : undefined,
    cover_mime: body.cover_mime != null ? String(body.cover_mime) : undefined,
    keywords: body.keywords != null ? String(body.keywords) : undefined,
    status:
      body.status === "published" ? "published" : body.status === "draft" ? "draft" : undefined,
    tag_labels: Array.isArray(body.tag_labels) ? body.tag_labels.map(String) : [],
    slug: body.slug != null ? String(body.slug) : undefined,
  });
  if (!res.ok) return c.json({ error: res.error }, 400);
  return c.json({ post: res.post });
});

adminSubApp.delete("/blog/posts/:id", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  await deleteBlogPost(id);
  return c.json({ ok: true });
});

adminSubApp.post("/blog/upload", async (c) => {
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
  const mime = String(blob.type || "").toLowerCase();
  const isVideo = mime.startsWith("video/");
  const max = isVideo ? 50 * 1024 * 1024 : 8 * 1024 * 1024;
  if (buffer.length > max) {
    return c.json({ error: isVideo ? "Видео не больше 50 МБ" : "Файл не больше 8 МБ" }, 400);
  }
  const extMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
  };
  const ext = extMap[mime];
  if (!ext) {
    return c.json({ error: "Допустимы изображения (JPEG, PNG, WebP, GIF) или видео (MP4, WebM, MOV)" }, 400);
  }
  const name = `${randomUUID()}${ext}`;
  await writeUploadToDirs(blogUploadsDirs, name, buffer);
  const url = `/uploads/blog/${name}`;
  return c.json({ url, mime });
});

adminSubApp.get("/prizes", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  c.header("Cache-Control", "no-store");
  const status = String(c.req.query("status") || "all");
  const q = String(c.req.query("q") || "");
  const offset = Number(c.req.query("offset") || 0);
  const limit = Number(c.req.query("limit") || 40);
  const page = await listPrizeAwardsForAdmin({ status, q, offset, limit });
  return c.json({
    prizes: page.prizes.map((p) => prizeAwardToDto(p, page.users.get(p.user_id))),
    total: page.total,
    offset,
    limit,
    has_more: offset + page.prizes.length < page.total,
  });
});

adminSubApp.get("/prizes/:id", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  const row = await getPrizeAwardById(id);
  if (!row) return c.json({ error: "Не найдено" }, 404);
  const user = await getUserById(row.user_id);
  return c.json({
    prize: await prizeAwardToDtoAsync(row, user ? { name: user.name, phone: user.phone } : undefined),
  });
});

adminSubApp.post("/prizes", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const userId = Number(body.user_id);
  if (!Number.isFinite(userId)) return c.json({ error: "Укажите пользователя" }, 400);
  const res = await createPrizeAward({
    userId,
    title: String(body.title || ""),
    description: String(body.description || ""),
    createdByUserId: auth.id,
    introMessage: String(body.intro_message || ""),
    sendChat: body.send_chat !== false,
  });
  if (!res.ok) return c.json({ error: res.error }, 400);
  if (res.messageId) {
    await markThreadReadByStaff(userId);
    broadcastThreadReadByStaff(userId);
    const row = await getSupportMessageById(res.messageId);
    if (row) broadcastChatMessage(userId, messageToDto(row));
    notifyUserEmailStaffReply(userId, { body: "", attachmentName: null, attachmentMime: null });
  }
  const user = await getUserById(userId);
  return c.json({
    prize: await prizeAwardToDtoAsync(res.prize, user ? { name: user.name, phone: user.phone } : undefined),
  });
});

adminSubApp.patch("/prizes/:id", async (c) => {
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Некорректный JSON" }, 400);
  }
  const res = await updatePrizeAwardAdmin(id, {
    admin_notes: body.admin_notes != null ? String(body.admin_notes) : undefined,
    mark_done: Boolean(body.mark_done),
  });
  if (!res.ok) return c.json({ error: res.error }, 400);
  const user = await getUserById(res.prize.user_id);
  return c.json({
    prize: await prizeAwardToDtoAsync(res.prize, user ? { name: user.name, phone: user.phone } : undefined),
  });
});
