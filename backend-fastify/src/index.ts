import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { getRequestListener } from "@hono/node-server";
import { adminSubApp } from "../../server/admin-subapp.js";
import bcrypt from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer } from "ws";
import {
  countUnreadStaffMessagesForUser,
  getLatestVisibleActiveRaffle,
  getRaffleById,
  getRaffleByHash,
  getSiteSettings,
  getSupportMessageById,
  insertSupportMessage,
  listLatestSupportMessagesForUser,
  listSupportMessagesForUserBeforeId,
  isRaffleVisibleOnSite,
  listRafflesPublic,
  listSupportMessagesForUser,
  markStaffMessagesReadByUser,
  messageToDto,
  raffleToDto,
} from "../../server/db.js";
import { pgAll } from "../../server/pg-sql.js";
import {
  createSessionPg,
  deleteSessionPg,
  getUserByEmailPg,
  getUserByIdPg,
  getUserByPhonePg,
  getUserBySessionTokenPg,
  insertUserPg,
  touchUserLastActivePg,
  updateUserEmailNotifyPrefsPg,
  updateUserLocalityPg,
  updateUserPasswordHashPg,
} from "../../server/db-auth-pg.js";
import { ensurePgRuntimeSchema, isPgConnectivityError } from "../../server/pg.js";
import { extForChatMime, parseChatAttachmentFromMessage } from "../../server/chat-attachments.js";
import {
  addTicketsToReservedOrder,
  appendRandomTicketsToReservedOrder,
  attachReceiptToOrder,
  buildRafflePaymentParticipationContext,
  clearAllUserReservedCartItems,
  createReservation,
  getActiveOrderForUser,
  getOrderByIdForUser,
  getPublicOrderStatusByToken,
  getTicketCellKind,
  getTicketGridSlice,
  getTicketNumbersForOrder,
  listConfirmedTicketGroupsForUser,
  listGloballyFreeTicketNumbers,
  listParticipationHistoryForUser,
  getParticipationHistorySummaryForUser,
  listPendingReviewTicketGroupsForUser,
  listReservedOrdersForUserLite,
  listMyTicketsBundleForUser,
  getMyTicketsSummaryForUser,
  listWholesaleSlotsForUser,
  materializeRafflePreassignmentsForUser,
  orderToDto,
  removeTicketFromReservedOrder,
  setOrderBank,
  userCancelReservedRaffleOrder,
} from "../../server/raffle-orders.js";
import { isValidRuMobile, normalizePhone } from "../../server/phone.js";
import { getStaffTypingForUser } from "../../server/typing-state.js";
import {
  attachWebSocket,
  broadcastChatMessage,
  broadcastRaffleGridUpdated,
  broadcastRaffleTicketsUpdated,
  broadcastRaffleViewersUpdated,
  broadcastTypingUserToAdmins,
} from "../../server/ws-chat.js";
import type { FastifyReply, FastifyRequest } from "fastify";

const rateLimitBuckets = new Map<string, { win: number; n: number }>();
const paymentParticipationCache = new Map<
  string,
  { ts: number; data: Awaited<ReturnType<typeof buildRafflePaymentParticipationContext>> }
>();
const latestTableCache = new Map<
  number,
  {
    ts: number;
    payload: {
      raffle: { id: number; title: string; ticket_count: number; status: string } | null;
      rows: Array<{ n: number; status: "free" | "taken" | "self_reserved" | "self_pending" | "self_confirmed"; phone: string | null }>;
    };
  }
>();

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

function getClientIp(request: FastifyRequest): string {
  const xfwd = String(request.headers["x-forwarded-for"] ?? "");
  const ip = xfwd.split(",")[0]?.trim();
  return ip || String(request.headers["x-real-ip"] ?? "") || request.ip || "local";
}

function compressToRanges(nums: number[]): Array<[number, number]> {
  if (!nums.length) return [];
  const arr = nums
    .map((n) => Math.floor(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (!arr.length) return [];
  const out: Array<[number, number]> = [];
  let start = arr[0]!;
  let prev = arr[0]!;
  for (let i = 1; i < arr.length; i++) {
    const cur = arr[i]!;
    if (cur <= prev + 1) {
      prev = cur;
      continue;
    }
    out.push([start, prev]);
    start = cur;
    prev = cur;
  }
  out.push([start, prev]);
  return out;
}

async function getCachedPaymentParticipation(userId: number, raffleId: number, currentOrderId: number | null) {
  const key = `${userId}:${raffleId}:${currentOrderId ?? 0}`;
  const now = Date.now();
  const cached = paymentParticipationCache.get(key);
  if (cached && now - cached.ts < 5000) return cached.data;
  const data = await buildRafflePaymentParticipationContext(userId, raffleId, currentOrderId);
  paymentParticipationCache.set(key, { ts: now, data });
  if (paymentParticipationCache.size > 2000) {
    const cutoff = now - 30_000;
    for (const [k, v] of paymentParticipationCache) {
      if (v.ts < cutoff) paymentParticipationCache.delete(k);
    }
  }
  return data;
}

async function getAuthUser(request: FastifyRequest) {
  const auth = request.headers.authorization;
  const token = auth && auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  return (await getUserBySessionTokenPg(token)) ?? null;
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await getAuthUser(request);
  if (!user) {
    void reply.code(401).send({ error: "Не авторизован" });
    return null;
  }
  if (Number(user.blocked) === 1) {
    void reply.code(403).send({ error: "Аккаунт заблокирован", code: "account_blocked" });
    return null;
  }
  await touchUserLastActivePg(user.id);
  return user;
}

async function raffleVisibleOrActiveOrder(userId: number, raffleId: number) {
  const raffle = await getRaffleById(raffleId);
  if (!raffle) return null;
  if (isRaffleVisibleOnSite(raffle)) return raffle;
  const order = await getActiveOrderForUser(raffleId, userId);
  if (order) return raffle;
  return null;
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

function notifyRaffleGridMutated(raffleId: number | undefined | null): void {
  const r = Math.floor(Number(raffleId));
  if (Number.isFinite(r) && r > 0) broadcastRaffleGridUpdated(r);
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

const host = process.env.API_HOST || "0.0.0.0";
const port = Number(process.env.API_PORT || 8787);

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: true,
  credentials: true,
});

await app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
});

const adminHonoFetch = adminSubApp.fetch.bind(adminSubApp);
const adminNodeListener = getRequestListener(adminHonoFetch);

function headersToWebHeaders(headers: FastifyRequest["headers"]): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) h.append(k, item);
    } else {
      h.set(k, String(v));
    }
  }
  return h;
}

async function copyHonoResponseToFastify(reply: FastifyReply, res: Response): Promise<void> {
  reply.code(res.status);
  res.headers.forEach((value, name) => {
    try {
      reply.header(name, value);
    } catch {
      /* ignore hop-by-hop / invalid */
    }
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return reply.send(buf);
}

async function readPublicAsset(assetName: string): Promise<Buffer | null> {
  const safe = String(assetName || "").replace(/^\/+/, "");
  if (!safe || safe.includes("..") || safe.includes("\\") || safe.includes("/")) return null;
  const roots = [
    path.resolve(process.cwd(), "next-app", "public"),
    path.resolve(process.cwd(), "public"),
  ];
  for (const root of roots) {
    const full = path.resolve(root, safe);
    if (!full.startsWith(root)) continue;
    if (!existsSync(full)) continue;
    try {
      return await readFile(full);
    } catch {
      /* try next root */
    }
  }
  return null;
}

function mimeByAssetName(assetName: string): string {
  const n = String(assetName || "").toLowerCase();
  if (n.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".ico")) return "image/x-icon";
  if (n.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
  return "application/octet-stream";
}

async function sendPublicAsset(reply: FastifyReply, assetName: string): Promise<void> {
  const buf = await readPublicAsset(assetName);
  if (!buf) {
    reply.code(404).send({ ok: false, error: "Not Found", asset: assetName });
    return;
  }
  reply.header("Content-Type", mimeByAssetName(assetName));
  reply.header("Cache-Control", "public, max-age=86400");
  reply.send(buf);
}

await app.register(
  async function adminHonoBridge(f) {
    f.all("/*", async (request, reply) => {
      const ct = String(request.headers["content-type"] ?? "").toLowerCase();
      if (ct.includes("multipart/form-data")) {
        reply.hijack();
        await adminNodeListener(request.raw, reply.raw);
        return;
      }

      const url = `http://127.0.0.1${request.raw.url ?? "/"}`;
      const method = request.method;
      let body: BodyInit | undefined;
      if (method !== "GET" && method !== "HEAD") {
        if (ct.includes("application/json")) {
          body =
            request.body === undefined || request.body === null
              ? undefined
              : JSON.stringify(request.body);
        } else if (typeof request.body === "string") {
          body = request.body;
        } else if (Buffer.isBuffer(request.body)) {
          body = new Uint8Array(request.body);
        } else if (request.body != null && typeof request.body === "object") {
          body = JSON.stringify(request.body);
        }
      }

      const webReq = new Request(url, {
        method,
        headers: headersToWebHeaders(request.headers),
        body,
      });
      const honoRes = await adminHonoFetch(webReq);
      await copyHonoResponseToFastify(reply, honoRes);
    });
  },
  { prefix: "/api/admin" },
);

app.get("/favicon.ico", async (request, reply) => {
  const svg = await readPublicAsset("favicon.svg");
  if (svg) {
    reply.header("Content-Type", "image/svg+xml; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(svg);
  }
  return reply.redirect("/favicon.svg");
});

app.get("/favicon.svg", async (_request, reply) => {
  await sendPublicAsset(reply, "favicon.svg");
});

app.get("/logo-ab.svg", async (_request, reply) => {
  await sendPublicAsset(reply, "logo-ab.svg");
});

app.get("/og-cover.svg", async (_request, reply) => {
  await sendPublicAsset(reply, "og-cover.svg");
});

app.get("/dice.svg", async (_request, reply) => {
  await sendPublicAsset(reply, "dice.svg");
});

app.get("/dice.png", async (_request, reply) => {
  return reply.redirect("/dice.svg");
});

const receiptUploadsDirs = [
  path.resolve(process.cwd(), "public", "uploads", "receipts"),
  path.resolve(process.cwd(), "uploads", "receipts"),
];
for (const dir of receiptUploadsDirs) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const chatUploadsDirs = [
  path.resolve(process.cwd(), "public", "uploads", "chat"),
  path.resolve(process.cwd(), "uploads", "chat"),
];
for (const dir of chatUploadsDirs) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function extForReceiptMime(mime: string): string | null {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  if (m === "image/jpeg" || m === "image/jpg") return ".jpg";
  if (m === "image/png") return ".png";
  if (m === "image/webp") return ".webp";
  if (m === "application/pdf") return ".pdf";
  return null;
}

async function writeUploadToDirs(fileName: string, content: Buffer) {
  for (const dir of receiptUploadsDirs) {
    await writeFile(path.join(dir, fileName), content);
  }
}

async function writeChatUploadToDirs(fileName: string, content: Buffer) {
  for (const dir of chatUploadsDirs) {
    await writeFile(path.join(dir, fileName), content);
  }
}

app.get("/health", async () => {
  return {
    ok: true,
    service: "backend-fastify",
    ts: Date.now(),
  };
});

app.get("/api/health", async () => {
  return {
    ok: true,
    api: "fastify",
  };
});

app.get("/api/site/status", async (_request, reply) => {
  reply.header("Cache-Control", "no-store");
  const settings = await getSiteSettings();
  return {
    maintenance: settings.maintenance_enabled,
  };
});

app.get("/api/raffles", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  reply.header("Cache-Control", "private, no-store");
  const rows = await listRafflesPublic();
  if (!rows.length) return { raffles: [] };
  const raffleIds = rows
    .map((r) => Math.floor(Number(r.id)))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!raffleIds.length) return { raffles: [] };
  const placeholders = raffleIds.map(() => "?").join(", ");

  const occupiedByRaffle = new Map<number, number>();
  const occupiedRows = await pgAll<{ raffle_id: number; c: number }>(
    `SELECT h.raffle_id AS raffle_id, COUNT(*) AS c
       FROM raffle_ticket_holds h
       INNER JOIN raffle_orders o ON o.id = h.order_id
       WHERE h.raffle_id IN (${placeholders}) AND o.status NOT IN ('expired', 'rejected')
       GROUP BY h.raffle_id`,
    raffleIds,
  );
  for (const row of occupiedRows) {
    occupiedByRaffle.set(Math.floor(Number(row.raffle_id)), Math.max(0, Number(row.c) || 0));
  }
  const preRows = await pgAll<{ raffle_id: number; c: number }>(
    `SELECT raffle_id AS raffle_id, COUNT(*) AS c
       FROM raffle_phone_preassignments
       WHERE raffle_id IN (${placeholders})
       GROUP BY raffle_id`,
    raffleIds,
  );
  for (const row of preRows) {
    const rid = Math.floor(Number(row.raffle_id));
    occupiedByRaffle.set(rid, Math.max(0, (occupiedByRaffle.get(rid) ?? 0) + (Number(row.c) || 0)));
  }

  const activeOrderByRaffle = new Map<number, { id: number; status: string }>();
  const orderRows = await pgAll<{ id: number; raffle_id: number; status: string }>(
    `SELECT id, raffle_id, status
       FROM raffle_orders
       WHERE user_id = ? AND raffle_id IN (${placeholders}) AND status IN ('reserved', 'pending_review')
       ORDER BY id DESC`,
    [user.id, ...raffleIds],
  );
  for (const row of orderRows) {
    const rid = Math.floor(Number(row.raffle_id));
    if (activeOrderByRaffle.has(rid)) continue;
    activeOrderByRaffle.set(rid, {
      id: Math.floor(Number(row.id)),
      status: String(row.status || ""),
    });
  }

  return {
    raffles: rows.map((r) => {
      const dto = raffleToDto(r);
      const occupied = Math.min(Math.max(0, occupiedByRaffle.get(r.id) ?? 0), Number(dto.ticket_count) || 0);
      const myOrder = activeOrderByRaffle.get(r.id) ?? null;
      return {
        ...dto,
        occupied_count: occupied,
        free_count: Math.max(0, Number(dto.ticket_count) - occupied),
        viewers_count: getRaffleViewerCount(r.id),
        my_order_status: myOrder?.status ?? null,
        my_order_id: myOrder?.id ?? null,
      };
    }),
  };
});

app.get("/api/raffles/latest-visible/table", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!rateLimitAllow(`get:latest-visible-table:${user.id}`, 30, 60_000)) {
    return reply.code(429).send({ error: "Слишком много запросов. Подождите немного." });
  }
  reply.header("Cache-Control", "private, no-store");
  const rows = await listRafflesPublic();
  const latest = rows
    .map((r) => r)
    .filter((r) => Math.floor(Number(r.ticket_count) || 0) > 0)
    .sort((a, b) => Math.floor(Number(b.id) || 0) - Math.floor(Number(a.id) || 0))[0];
  if (!latest) {
    return { raffle: null, rows: [], server_time_ms: Date.now() };
  }
  const raffleId = Math.floor(Number(latest.id) || 0);
  const ticketCount = Math.max(0, Math.floor(Number(latest.ticket_count) || 0));
  const now = Date.now();
  const cached = latestTableCache.get(raffleId);
  if (cached && now - cached.ts < 15_000) {
    return { ...cached.payload, server_time_ms: now };
  }

  const ownPhone = String(user.phone || "");
  const ownByNumber = new Map<number, { status: "self_reserved" | "self_pending" | "self_confirmed"; phone: string | null; prio: number }>();
  const holdRows = await pgAll<{ n: number; order_status: string; order_user_id: number; phone: string | null; order_id: number }>(
    `SELECT
       h.ticket_number AS n,
       o.status AS order_status,
       o.user_id AS order_user_id,
       u.phone AS phone,
       o.id AS order_id
     FROM raffle_ticket_holds h
     INNER JOIN raffle_orders o ON o.id = h.order_id
     INNER JOIN users u ON u.id = o.user_id
     WHERE h.raffle_id = ? AND o.status IN ('reserved', 'pending_review', 'confirmed')`,
    [raffleId],
  );
  const byNumber = new Map<number, { status: "taken" | "self_reserved" | "self_pending" | "self_confirmed"; phone: string | null; prio: number; orderId: number }>();
  const statusPrio = (status: string): number => {
    if (status === "confirmed") return 5;
    if (status === "pending_review") return 4;
    if (status === "reserved") return 3;
    return 1;
  };
  for (const row of holdRows) {
    const n = Math.floor(Number(row.n));
    if (!Number.isFinite(n) || n < 1 || n > ticketCount) continue;
    const prio = statusPrio(String(row.order_status || ""));
    const isSelf = Math.floor(Number(row.order_user_id) || 0) === user.id;
    const phone = String(row.phone || "").trim() || null;
    const status = isSelf
      ? String(row.order_status || "") === "confirmed"
        ? "self_confirmed"
        : String(row.order_status || "") === "pending_review"
          ? "self_pending"
          : "self_reserved"
      : "taken";
    const prev = byNumber.get(n);
    const orderId = Math.floor(Number(row.order_id) || 0);
    if (!prev || prio > prev.prio || (prio === prev.prio && orderId > prev.orderId)) {
      byNumber.set(n, { status, phone, prio, orderId });
    }
    if (isSelf) {
      const prevOwn = ownByNumber.get(n);
      if (!prevOwn || prio > prevOwn.prio) {
        ownByNumber.set(n, { status: status as "self_reserved" | "self_pending" | "self_confirmed", phone, prio });
      }
    }
  }

  const preRows = await pgAll<{ n: number; phone: string }>(
    `SELECT ticket_number AS n, phone AS phone
     FROM raffle_phone_preassignments
     WHERE raffle_id = ?`,
    [raffleId],
  );
  for (const row of preRows) {
    const n = Math.floor(Number(row.n));
    if (!Number.isFinite(n) || n < 1 || n > ticketCount) continue;
    const prePhone = String(row.phone || "").trim();
    const isSelf = prePhone && prePhone === ownPhone;
    const status = isSelf ? "self_confirmed" : "taken";
    const prev = byNumber.get(n);
    if (!prev || 6 > prev.prio) {
      byNumber.set(n, { status, phone: prePhone || null, prio: 6, orderId: Number.MAX_SAFE_INTEGER });
    }
    if (isSelf) {
      ownByNumber.set(n, { status: "self_confirmed", phone: prePhone || null, prio: 6 });
    }
  }

  const tableRows: Array<{ n: number; status: "free" | "taken" | "self_reserved" | "self_pending" | "self_confirmed"; phone: string | null }> = [];
  for (let n = 1; n <= ticketCount; n++) {
    const own = ownByNumber.get(n);
    if (own) {
      tableRows.push({ n, status: own.status, phone: own.phone });
      continue;
    }
    const row = byNumber.get(n);
    if (row) {
      tableRows.push({ n, status: row.status, phone: row.phone });
      continue;
    }
    tableRows.push({ n, status: "free", phone: null });
  }

  const payload = {
    raffle: {
      id: raffleId,
      title: String(latest.title || "Акция"),
      ticket_count: ticketCount,
      status: String(latest.status || ""),
    },
    rows: tableRows,
  };
  latestTableCache.set(raffleId, { ts: now, payload });
  if (latestTableCache.size > 20) {
    const cutoff = now - 60_000;
    for (const [key, value] of latestTableCache) {
      if (value.ts < cutoff) latestTableCache.delete(key);
    }
  }
  return { ...payload, server_time_ms: now };
});

app.get("/api/public/latest-raffle/free-numbers", async (_request, reply) => {
  reply.header("Cache-Control", "no-store");
  const row = await getLatestVisibleActiveRaffle();
  if (!row) {
    return {
      raffle: null,
      raffle_id: null,
      ticket_count: 0,
      free_numbers: [],
      free_count: 0,
      server_time_ms: Date.now(),
    };
  }
  const free = await listGloballyFreeTicketNumbers(row.id);
  const freeRanges = compressToRanges(free);
  const q = (_request.query ?? {}) as { full?: string; compact?: string };
  const wantFull = String(q.full ?? "").trim() === "1";
  const wantCompact = String(q.compact ?? "").trim() === "1";
  const includeFreeNumbers = wantFull || (!wantCompact && free.length <= 2500);
  return {
    raffle: raffleToDto(row),
    raffle_id: row.id,
    ticket_count: row.ticket_count,
    free_numbers: includeFreeNumbers ? free : [],
    free_ranges: freeRanges,
    free_count: free.length,
    server_time_ms: Date.now(),
  };
});

app.get("/api/public/raffle-order-status", async (request, reply) => {
  const ip = getClientIp(request);
  if (!rateLimitAllow(`get:pub-order:${ip}`, 45, 60_000)) {
    return reply.code(429).send({ error: "Слишком много запросов. Подождите немного." });
  }
  reply.header("Cache-Control", "no-store");
  const q = request.query as { t?: string };
  const token = String(q?.t ?? "").trim();
  const dto = await getPublicOrderStatusByToken(token);
  if (!dto) return { found: false };
  return dto;
});

app.post("/api/auth/register", async (request, reply) => {
  const body = (request.body ?? {}) as {
    phone?: string;
    name?: string;
    email?: string;
    locality?: string;
    password?: string;
  };
  const phone = normalizePhone(String(body.phone ?? ""));
  const name = String(body.name ?? "").trim();
  const emailRaw = String(body.email ?? "").trim().toLowerCase();
  const locality = String(body.locality ?? "").trim().slice(0, 120);
  const password = String(body.password ?? "");

  if (!phone) return reply.code(400).send({ error: "Введите полный номер телефона" });
  if (!isValidRuMobile(phone)) return reply.code(400).send({ error: "Нужен мобильный номер России (+7 9XX …)" });
  if (!name) return reply.code(400).send({ error: "Укажите ФИО" });
  if (!locality) return reply.code(400).send({ error: "Укажите населенный пункт" });
  if (password.length < 6) return reply.code(400).send({ error: "Пароль не короче 6 символов" });
  if (await getUserByPhonePg(phone)) {
    return reply.code(409).send({ error: "Этот номер телефона уже зарегистрирован" });
  }

  let emailDb: string | null = null;
  if (emailRaw) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return reply.code(400).send({ error: "Укажите корректный email" });
    }
    if (await getUserByEmailPg(emailRaw)) {
      return reply.code(409).send({ error: "Этот email уже зарегистрирован" });
    }
    emailDb = emailRaw;
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = await insertUserPg(phone, name, emailDb, locality, passwordHash);
  try {
    await materializeRafflePreassignmentsForUser(userId);
  } catch {}
  const row = await getUserByIdPg(userId);
  const token = randomUUID();
  await createSessionPg(token, userId);
  return {
    token,
    user: {
      id: userId,
      phone,
      name,
      email: row?.email != null && String(row.email).trim() ? String(row.email).trim().toLowerCase() : "",
      locality: row?.locality != null ? String(row.locality).trim() : "",
      role: row?.role ?? "user",
      blocked: false,
    },
  };
});

app.post("/api/auth/login", async (request, reply) => {
  const body = (request.body ?? {}) as { phone?: string; password?: string };
  const phone = normalizePhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");
  if (!phone) return reply.code(400).send({ error: "Введите полный номер телефона" });
  if (!isValidRuMobile(phone)) return reply.code(400).send({ error: "Нужен мобильный номер России (+7 9XX …)" });
  if (!password) return reply.code(400).send({ error: "Введите пароль" });

  const user = await getUserByPhonePg(phone);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return reply.code(401).send({ error: "Неверный телефон или пароль" });
  }
  if (Number(user.blocked) === 1) {
    return reply.code(403).send({ error: "Аккаунт заблокирован. Обратитесь в поддержку.", code: "account_blocked" });
  }
  const token = randomUUID();
  await createSessionPg(token, user.id);
  try {
    await materializeRafflePreassignmentsForUser(user.id);
  } catch {}
  return {
    token,
    user: {
      id: user.id,
      phone: user.phone,
      name: user.name,
      email: user.email != null && String(user.email).trim() ? String(user.email).trim().toLowerCase() : "",
      locality: user.locality != null ? String(user.locality).trim() : "",
      role: user.role ?? "user",
      blocked: Number(user.blocked) === 1,
    },
  };
});

app.get("/api/auth/me", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const row = await getUserByIdPg(user.id);
  return {
    user: {
      id: user.id,
      phone: user.phone,
      name: user.name,
      email: user.email != null && String(user.email).trim() ? String(user.email).trim().toLowerCase() : "",
      locality: row?.locality != null ? String(row.locality).trim() : "",
      role: user.role ?? "user",
      blocked: Number(user.blocked) === 1,
      email_notify_chat: row ? Number(row.email_notify_chat ?? 1) !== 0 : true,
      email_notify_raffles: row ? Number(row.email_notify_raffles ?? 1) !== 0 : true,
      email_notify_raffle_orders: row ? Number(row.email_notify_raffle_orders ?? 1) !== 0 : true,
    },
  };
});

app.patch("/api/auth/locality", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = (request.body ?? {}) as { locality?: unknown };
  const locality = String(body.locality ?? "").trim().slice(0, 120);
  if (!locality) return reply.code(400).send({ error: "Укажите населенный пункт" });
  await updateUserLocalityPg(user.id, locality);
  return { ok: true, locality };
});

app.post("/api/auth/logout", async (request) => {
  const auth = request.headers.authorization;
  const token = auth && auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token) await deleteSessionPg(token);
  return { ok: true };
});

app.post("/api/auth/change-password", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = (request.body ?? {}) as { current_password?: string; new_password?: string };
  const current = String(body.current_password ?? "");
  const nextPw = String(body.new_password ?? "");
  if (!current) return reply.code(400).send({ error: "Введите текущий пароль" });
  if (nextPw.length < 6) {
    return reply.code(400).send({ error: "Новый пароль не короче 6 символов" });
  }
  if (nextPw === current) {
    return reply.code(400).send({ error: "Новый пароль должен отличаться от текущего" });
  }
  const row = await getUserByIdPg(user.id);
  if (!row || !bcrypt.compareSync(current, row.password_hash)) {
    return reply.code(400).send({ error: "Неверный текущий пароль" });
  }
  await updateUserPasswordHashPg(user.id, bcrypt.hashSync(nextPw, 10));
  return { ok: true };
});

app.patch("/api/auth/email-notifications", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = (request.body ?? {}) as {
    email_notify_chat?: unknown;
    email_notify_raffles?: unknown;
    email_notify_raffle_orders?: unknown;
  };
  const patch: {
    email_notify_chat?: boolean;
    email_notify_raffles?: boolean;
    email_notify_raffle_orders?: boolean;
  } = {};
  if (typeof body.email_notify_chat === "boolean") patch.email_notify_chat = body.email_notify_chat;
  if (typeof body.email_notify_raffles === "boolean") patch.email_notify_raffles = body.email_notify_raffles;
  if (typeof body.email_notify_raffle_orders === "boolean") {
    patch.email_notify_raffle_orders = body.email_notify_raffle_orders;
  }
  if (
    patch.email_notify_chat === undefined &&
    patch.email_notify_raffles === undefined &&
    patch.email_notify_raffle_orders === undefined
  ) {
    return reply.code(400).send({ error: "Нет полей для сохранения" });
  }
  await updateUserEmailNotifyPrefsPg(user.id, patch);
  const row = await getUserByIdPg(user.id);
  return {
    ok: true,
    email_notify_chat: row ? Number(row.email_notify_chat ?? 1) !== 0 : true,
    email_notify_raffles: row ? Number(row.email_notify_raffles ?? 1) !== 0 : true,
    email_notify_raffle_orders: row ? Number(row.email_notify_raffle_orders ?? 1) !== 0 : true,
  };
});

app.get("/api/raffles/cart", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!rateLimitAllow(`get:cart:${user.id}`, 60, 60_000)) {
    return reply.code(429).send({ error: "Слишком много запросов. Подождите немного." });
  }
  reply.header("Cache-Control", "private, no-store");
  const lite = await listReservedOrdersForUserLite(user.id);
  const items = await Promise.all(
    lite.map(async (it) => ({
      ...it,
      payment_participation: await getCachedPaymentParticipation(user.id, it.order.raffle_id, it.order.id),
    })),
  );
  return { items, server_time_ms: Date.now() };
});

app.post("/api/raffles/cart/clear", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!rateLimitAllow(`post:cart-clear:${user.id}`, 15, 60_000)) {
    return reply.code(429).send({ error: "Слишком много запросов. Подождите немного." });
  }
  const r = await clearAllUserReservedCartItems(user.id);
  if (!r.ok) return reply.code(400).send({ error: r.error });
  broadcastRaffleTicketsUpdated(user.id);
  for (const rid of r.raffle_ids) notifyRaffleGridMutated(rid);
  return { ok: true, server_time_ms: Date.now() };
});

app.get("/api/raffles/my-tickets", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!rateLimitAllow(`get:my-tickets:${user.id}`, 60, 60_000)) {
    return reply.code(429).send({ error: "Слишком много запросов. Подождите немного." });
  }
  reply.header("Cache-Control", "private, no-store");
  const q = (request.query ?? {}) as { mode?: string };
  if (String(q.mode || "").trim() === "summary") {
    const summary = await getMyTicketsSummaryForUser(user.id);
    return { ...summary, server_time_ms: Date.now() };
  }
  const bundle = await listMyTicketsBundleForUser(user.id);
  return {
    reserved: bundle.reserved,
    pending_review: bundle.pending_review,
    confirmed: bundle.confirmed,
    wholesale_slots: await listWholesaleSlotsForUser(user.id),
    server_time_ms: Date.now(),
  };
});

app.get("/api/raffles/participation-history", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!rateLimitAllow(`get:participation-history:${user.id}`, 60, 60_000)) {
    return reply.code(429).send({ error: "Слишком много запросов. Подождите немного." });
  }
  reply.header("Cache-Control", "private, no-store");
  const q = (request.query ?? {}) as { mode?: string };
  if (String(q.mode || "").trim() === "summary") {
    const summary = await getParticipationHistorySummaryForUser(user.id);
    return { ...summary, server_time_ms: Date.now() };
  }
  return {
    raffles: await listParticipationHistoryForUser(user.id),
    server_time_ms: Date.now(),
  };
});

app.get("/api/chat/unread", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  reply.header("Cache-Control", "private, no-store");
  return { unread_staff: await countUnreadStaffMessagesForUser(user.id) };
});

app.post("/api/chat/mark-staff-read", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  await markStaffMessagesReadByUser(user.id);
  reply.header("Cache-Control", "private, no-store");
  return { ok: true, unread_staff: 0 };
});

app.get("/api/chat/messages", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  reply.header("Cache-Control", "no-store");
  const query = (request.query ?? {}) as { before_id?: string; limit?: string };
  const before = Number(query.before_id);
  const lim = Number(query.limit);
  const limit = Number.isFinite(lim) ? Math.max(1, Math.min(100, Math.floor(lim))) : 40;
  const rows =
    Number.isFinite(before) && before > 0
      ? await listSupportMessagesForUserBeforeId(user.id, before, limit)
      : await listLatestSupportMessagesForUser(user.id, limit);
  const oldestId = rows[0]?.id ?? null;
  const hasMore = oldestId ? (await listSupportMessagesForUserBeforeId(user.id, oldestId, 1)).length > 0 : false;
  return {
    messages: rows.map((r) => messageToDto(r)),
    staff_typing: getStaffTypingForUser(user.id),
    has_more: hasMore,
  };
});

app.post("/api/chat/typing", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = (request.body ?? {}) as { active?: boolean };
  broadcastTypingUserToAdmins(user.id, Boolean(body.active));
  return { ok: true };
});

app.post("/api/chat/messages", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = (request.body ?? {}) as { body?: string; attachment?: unknown };
  const parsed = parseChatMessagePayload(body);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  const id = await insertSupportMessage(user.id, parsed.text, false, parsed.attachment);
  const row = await getSupportMessageById(id);
  if (row) broadcastChatMessage(user.id, messageToDto(row));
  const rows = await listSupportMessagesForUser(user.id);
  return {
    messages: rows.map((r) => messageToDto(r)),
  };
});

app.post("/api/chat/upload", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const part = await request.file();
  if (!part) return reply.code(400).send({ error: "Нет файла" });
  const mime = String(part.mimetype || "application/octet-stream").toLowerCase().split(";")[0].trim();
  const ext = extForChatMime(mime);
  if (!ext) return reply.code(400).send({ error: "Тип файла не поддерживается" });
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of part.file) {
    const b = Buffer.from(chunk);
    total += b.length;
    if (total > 10 * 1024 * 1024) {
      return reply.code(400).send({ error: "Файл не больше 10 МБ" });
    }
    chunks.push(b);
  }
  const buffer = Buffer.concat(chunks);
  const fileName = `${randomUUID()}${ext}`;
  await writeChatUploadToDirs(fileName, buffer);
  const originalName = String(part.filename || "файл").replace(/[<>\"]/g, "").slice(0, 255) || "файл";
  return {
    url: `/uploads/chat/${fileName}`,
    name: originalName,
    mime,
  };
});

app.post("/api/raffles/:id/viewing", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = request.params as { id?: string };
  const id = Number(params?.id);
  if (!Number.isFinite(id) || id < 1) return reply.code(400).send({ error: "Некорректный id" });
  const raffle = await raffleVisibleOrActiveOrder(user.id, id);
  if (!raffle) return reply.code(404).send({ error: "Не найдено" });
  touchRaffleViewer(id, user.id);
  broadcastRaffleViewersUpdated(id);
  return { ok: true, viewers_count: getRaffleViewerCount(id) };
});

app.get("/api/raffles/:id", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = request.params as { id?: string };
  const id = Number(params?.id);
  if (!Number.isFinite(id)) return reply.code(400).send({ error: "Некорректный id" });
  const raffle = await getRaffleById(id);
  if (!raffle) return reply.code(404).send({ error: "Не найдено" });
  const canAccess = isRaffleVisibleOnSite(raffle) || Boolean(await getActiveOrderForUser(id, user.id));
  if (!canAccess) return reply.code(404).send({ error: "Не найдено" });
  reply.header("Cache-Control", "private, no-store");
  return { raffle: { ...raffleToDto(raffle), viewers_count: getRaffleViewerCount(id) } };
});

app.get("/api/raffles/by-hash/:hash", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = request.params as { hash?: string };
  const hash = String(params?.hash || "").trim();
  if (!hash) return reply.code(400).send({ error: "Некорректный hash" });
  const raffle = await getRaffleByHash(hash);
  if (!raffle) return reply.code(404).send({ error: "Не найдено" });
  const canAccess = isRaffleVisibleOnSite(raffle) || Boolean(await getActiveOrderForUser(raffle.id, user.id));
  if (!canAccess) return reply.code(404).send({ error: "Не найдено" });
  reply.header("Cache-Control", "private, no-store");
  return { raffle: { ...raffleToDto(raffle), viewers_count: getRaffleViewerCount(raffle.id) } };
});

app.get("/api/raffles/:id/order", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = request.params as { id?: string };
  const id = Number(params?.id);
  if (!Number.isFinite(id)) return reply.code(400).send({ error: "Некорректный id" });
  const raffle = await raffleVisibleOrActiveOrder(user.id, id);
  if (!raffle) return reply.code(404).send({ error: "Не найдено" });
  const serverTimeMs = Date.now();
  const order = await getActiveOrderForUser(id, user.id);
  if (!order) {
    return {
      order: null,
      numbers: [],
      raffle: raffleToDto(raffle),
      server_time_ms: serverTimeMs,
      payment_participation: {
        has_confirmed_tickets: false,
        confirmed_ticket_numbers: [],
        receipt_submitted_event_count: 0,
        current_order_reject_count: 0,
        show_repeat_payment_notice: false,
        prior_receipts: [],
      },
    };
  }
  return {
    order: orderToDto(order),
    numbers: await getTicketNumbersForOrder(order.id),
    raffle: raffleToDto(raffle),
    server_time_ms: serverTimeMs,
    payment_participation: await getCachedPaymentParticipation(user.id, id, order.id),
  };
});

app.get("/api/raffles/:id/tickets", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!rateLimitAllow(`get:tickets-slice:${user.id}`, 180, 60_000)) {
    return reply.code(429).send({ error: "Слишком много запросов. Подождите немного." });
  }
  const params = request.params as { id?: string };
  const q = request.query as { from?: string; to?: string };
  const id = Number(params?.id);
  const from = Number(q?.from ?? "1");
  const to = Number(q?.to ?? "500");
  if (!Number.isFinite(id)) return reply.code(400).send({ error: "Некорректный id" });
  const raffle = await raffleVisibleOrActiveOrder(user.id, id);
  if (!raffle) return reply.code(404).send({ error: "Не найдено" });
  const slice = await getTicketGridSlice(id, user.id, from, to);
  return { ...slice, raffle: raffleToDto(raffle) };
});

app.get("/api/raffles/:id/ticket-lookup", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!rateLimitAllow(`get:ticket-lookup:${user.id}`, 120, 60_000)) {
    return reply.code(429).send({ error: "Слишком много запросов. Подождите немного." });
  }
  const params = request.params as { id?: string };
  const query = request.query as { n?: string };
  const id = Number(params?.id);
  const n = Number(query?.n);
  if (!Number.isFinite(id) || !Number.isFinite(n)) {
    return reply.code(400).send({ error: "Некорректные данные" });
  }
  const raffle = await raffleVisibleOrActiveOrder(user.id, id);
  if (!raffle) return reply.code(404).send({ error: "Не найдено" });
  if (n < 1 || n > raffle.ticket_count) return reply.code(400).send({ error: "Некорректный номер" });
  const ticketN = Math.floor(n);
  const kind = await getTicketCellKind(id, ticketN, user.id);
  return { n: ticketN, kind };
});

app.post("/api/raffles/:id/reserve", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!rateLimitAllow(`post:reserve:${user.id}`, 25, 60_000)) {
    return reply.code(429).send({ error: "Слишком много запросов. Подождите немного." });
  }
  const params = request.params as { id?: string };
  const id = Number(params?.id);
  const body = (request.body ?? {}) as { numbers?: number[] };
  const numbers = Array.isArray(body.numbers) ? body.numbers : [];
  const res = await createReservation(id, user.id, numbers);
  if (!res.ok) return reply.code(400).send({ error: res.error });
  const order = await getOrderByIdForUser(res.order_id, user.id);
  if (!order) return reply.code(500).send({ error: "Ошибка создания заявки" });
  return {
    order: orderToDto(order),
    numbers: await getTicketNumbersForOrder(res.order_id),
    reserved_until: res.reserved_until,
    server_time_ms: Date.now(),
    skipped_still_occupied: res.skipped_still_occupied,
    released_after_cleanup: res.released_after_cleanup,
    payment_participation: await buildRafflePaymentParticipationContext(user.id, id, order.id),
  };
});

app.post("/api/raffles/orders/:orderId/add-tickets", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = request.params as { orderId?: string };
  const orderId = Number(params?.orderId);
  if (!Number.isFinite(orderId)) return reply.code(400).send({ error: "Некорректный id" });
  const body = (request.body ?? {}) as { numbers?: number[] };
  const numbers = Array.isArray(body.numbers) ? body.numbers : [];
  const res = await addTicketsToReservedOrder(orderId, user.id, numbers);
  if (!res.ok) return reply.code(400).send({ error: res.error });
  const order = await getOrderByIdForUser(orderId, user.id);
  return {
    order: order ? orderToDto(order) : null,
    numbers: await getTicketNumbersForOrder(orderId),
    server_time_ms: Date.now(),
  };
});

app.post("/api/raffles/orders/:orderId/random-tickets", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = request.params as { orderId?: string };
  const orderId = Number(params?.orderId);
  if (!Number.isFinite(orderId)) return reply.code(400).send({ error: "Некорректный id" });
  const body = (request.body ?? {}) as { count?: number };
  const count = Math.floor(Number(body.count ?? 1));
  const res = await appendRandomTicketsToReservedOrder(orderId, user.id, count);
  if (!res.ok) return reply.code(400).send({ error: res.error });
  const order = await getOrderByIdForUser(orderId, user.id);
  return {
    order: order ? orderToDto(order) : null,
    numbers: await getTicketNumbersForOrder(orderId),
    picked: res.picked,
    server_time_ms: Date.now(),
  };
});

app.delete("/api/raffles/orders/:orderId/tickets/:ticketNum", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!rateLimitAllow(`del:ticket:${user.id}`, 45, 60_000)) {
    return reply.code(429).send({ error: "Слишком много запросов. Подождите немного." });
  }
  const params = request.params as { orderId?: string; ticketNum?: string };
  const orderId = Number(params?.orderId);
  const ticketNum = Number(params?.ticketNum);
  if (!Number.isFinite(orderId) || !Number.isFinite(ticketNum)) {
    return reply.code(400).send({ error: "Некорректный id" });
  }
  const res = await removeTicketFromReservedOrder(orderId, user.id, ticketNum);
  if (!res.ok) return reply.code(400).send({ error: res.error });
  return { order: res.order, numbers: res.numbers, server_time_ms: Date.now() };
});

app.post("/api/raffles/orders/:orderId/cancel-reservation", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!rateLimitAllow(`post:cancel-reservation:${user.id}`, 20, 60_000)) {
    return reply.code(429).send({ error: "Слишком много запросов. Подождите немного." });
  }
  const params = request.params as { orderId?: string };
  const orderId = Number(params?.orderId);
  if (!Number.isFinite(orderId)) return reply.code(400).send({ error: "Некорректный id" });
  const res = await userCancelReservedRaffleOrder(orderId, user.id);
  if (!res.ok) return reply.code(400).send({ error: res.error });
  return { ok: true, server_time_ms: Date.now() };
});

app.patch("/api/raffles/orders/:orderId/bank", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = request.params as { orderId?: string };
  const orderId = Number(params?.orderId);
  if (!Number.isFinite(orderId)) return reply.code(400).send({ error: "Некорректный id" });
  const body = (request.body ?? {}) as { bank?: string };
  const bank = body.bank === "sber" || body.bank === "other" ? body.bank : null;
  if (!bank) return reply.code(400).send({ error: "Укажите банк: sber или other" });
  const res = await setOrderBank(orderId, user.id, bank);
  if (!res.ok) return reply.code(400).send({ error: res.error });
  const order = await getOrderByIdForUser(orderId, user.id);
  if (!order) return reply.code(500).send({ error: "Ошибка" });
  return { order: orderToDto(order), server_time_ms: Date.now() };
});

app.get("/api/raffles/orders/:orderId", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = request.params as { orderId?: string };
  const orderId = Number(params?.orderId);
  if (!Number.isFinite(orderId)) return reply.code(400).send({ error: "Некорректный id" });
  const order = await getOrderByIdForUser(orderId, user.id);
  if (!order) return reply.code(404).send({ error: "Не найдено" });
  const raffle = await getRaffleById(order.raffle_id);
  if (!raffle) return reply.code(404).send({ error: "Не найдено" });
  reply.header("Cache-Control", "private, no-store");
  return {
    order: orderToDto(order),
    numbers: await getTicketNumbersForOrder(orderId),
    raffle: raffleToDto(raffle),
    server_time_ms: Date.now(),
    payment_participation: await buildRafflePaymentParticipationContext(user.id, order.raffle_id, order.id),
  };
});

app.post("/api/raffles/receipt-upload", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const part = await request.file();
  if (!part) return reply.code(400).send({ error: "Нет файла" });
  const mime = String(part.mimetype || "application/octet-stream").toLowerCase().split(";")[0].trim();
  const ext = extForReceiptMime(mime);
  if (!ext) return reply.code(400).send({ error: "Допустимы изображения или PDF" });
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of part.file) {
    const b = Buffer.from(chunk);
    total += b.length;
    if (total > 10 * 1024 * 1024) {
      return reply.code(400).send({ error: "Файл не больше 10 МБ" });
    }
    chunks.push(b);
  }
  const buffer = Buffer.concat(chunks);
  const fileName = `${randomUUID()}${ext}`;
  await writeUploadToDirs(fileName, buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const originalName = String(part.filename || "чек").replace(/[<>\"]/g, "").slice(0, 255) || "чек";
  return {
    url: `/uploads/receipts/${fileName}`,
    name: originalName,
    mime,
    sha256,
  };
});

app.post("/api/raffles/orders/:orderId/receipt", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = request.params as { orderId?: string };
  const orderId = Number(params?.orderId);
  if (!Number.isFinite(orderId)) return reply.code(400).send({ error: "Некорректный id" });
  const body = (request.body ?? {}) as { url?: string; name?: string; mime?: string; sha256?: string };
  const url = String(body.url ?? "").trim();
  const name = String(body.name ?? "чек").slice(0, 255);
  const mime = String(body.mime ?? "application/octet-stream").slice(0, 120);
  const sha256 = String(body.sha256 ?? "").trim().toLowerCase();
  const res = await attachReceiptToOrder(orderId, user.id, { url, name, mime, sha256 });
  if (!res.ok) return reply.code(400).send({ error: res.error });
  const order = await getOrderByIdForUser(orderId, user.id);
  if (!order) return reply.code(500).send({ error: "Ошибка" });
  return {
    order: orderToDto(order),
    server_time_ms: Date.now(),
    payment_participation: await buildRafflePaymentParticipationContext(user.id, order.raffle_id, order.id),
  };
});

app.setErrorHandler((err, request, reply) => {
  if (reply.sent) {
    request.log.error({ err }, "reply already sent");
    return;
  }
  if (isPgConnectivityError(err)) {
    request.log.error({ err }, "postgres connectivity");
    return reply.code(503).send({
      error: "База данных временно недоступна.",
      code: "db_unavailable",
    });
  }
  request.log.error({ err }, "unhandled error");
  return reply.code(500).send({ error: "Internal Server Error" });
});

app.setNotFoundHandler(async (request, reply) => {
  return reply.code(404).send({
    ok: false,
    error: "Not Found",
    path: request.url,
  });
});

try {
  await ensurePgRuntimeSchema();
  await app.listen({ host, port });
  const wss = new WebSocketServer({ noServer: true });
  attachWebSocket(wss);
  app.server.on("upgrade", (request, socket, head) => {
    const hostHdr = request.headers.host ?? "127.0.0.1";
    try {
      const u = new URL(request.url ?? "/", `http://${hostHdr}`);
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
  const logHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  app.log.info(`Fastify API on http://${logHost}:${port} (bind ${host}:${port})`);
  app.log.info(`WebSocket ws://127.0.0.1:${port}/ws`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
