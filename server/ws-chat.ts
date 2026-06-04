import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  getSupportMessageById,
  getUserById,
  insertSupportMessage,
  listSupportMessagesForUser,
  markThreadReadByStaff,
  messageToDto,
} from "./db.js";
import { getUserBySessionTokenPg } from "./db-auth-pg.js";
import { parseChatAttachmentFromMessage } from "./chat-attachments.js";
import { notifyUserEmailStaffReply } from "./notify-email.js";
import { applyStaffSupportGreetingForUser } from "./support-staff-greeting.js";
import { setStaffTypingForUser, setUserTyping } from "./typing-state.js";

const OPEN = WebSocket.OPEN;

const adminSockets = new Set<WebSocket>();
const userSockets = new Map<number, Set<WebSocket>>();
/** Анонимные клиенты (страница /numbers): только события сетки и ленты акций */
const publicRaffleFeedSockets = new Set<WebSocket>();
/** Анонимные клиенты публичной страницы /table */
const publicTableSockets = new Set<WebSocket>();

/** SQLite/JSON иногда дают id как number | string — Map ключи должны совпадать */
function uid(userId: number): number {
  const n = Number(userId);
  return Number.isFinite(n) ? n : 0;
}

function addUserSocket(userId: number, ws: WebSocket) {
  const id = uid(userId);
  if (!id) return;
  let set = userSockets.get(id);
  if (!set) {
    set = new Set();
    userSockets.set(id, set);
  }
  set.add(ws);
}

function removeUserSocket(userId: number, ws: WebSocket) {
  const id = uid(userId);
  if (!id) return;
  const set = userSockets.get(id);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) userSockets.delete(id);
}

/** Поддержка открыла диалог — все исходящие пользователя помечены прочитанными */
export function broadcastThreadReadByStaff(userId: number) {
  const id = uid(userId);
  if (!id) return;
  const payload = JSON.stringify({ type: "thread_read", userId: id });
  const set = userSockets.get(id);
  if (!set) return;
  for (const ws of set) {
    try {
      if (ws.readyState === OPEN) ws.send(payload);
    } catch {
      /* ignore */
    }
  }
}

export function broadcastChatMessage(userId: number, message: ReturnType<typeof messageToDto>) {
  const id = uid(userId);
  const payloadAdmin = JSON.stringify({
    type: "chat_message",
    userId: id,
    message,
  });
  const payloadUser = JSON.stringify({
    type: "chat_message",
    userId: id,
    message,
  });
  for (const ws of adminSockets) {
    try {
      if (ws.readyState === OPEN) ws.send(payloadAdmin);
    } catch {
      /* ignore */
    }
  }
  if (!id) return;
  const set = userSockets.get(id);
  if (!set) return;
  for (const ws of set) {
    try {
      if (ws.readyState === OPEN) ws.send(payloadUser);
    } catch {
      /* ignore */
    }
  }
}

/** Уведомление клиенту: обновились данные "Мои билеты" */
export function broadcastRaffleTicketsUpdated(userId: number) {
  const id = uid(userId);
  if (!id) return;
  const payload = JSON.stringify({ type: "raffle_tickets_updated" });
  const set = userSockets.get(id);
  if (!set) return;
  for (const ws of set) {
    try {
      if (ws.readyState === OPEN) ws.send(payload);
    } catch {
      /* ignore */
    }
  }
}

function broadcastJsonToPublicRaffleFeed(payload: unknown) {
  const raw = JSON.stringify(payload);
  for (const ws of publicRaffleFeedSockets) {
    try {
      if (ws.readyState === OPEN) ws.send(raw);
    } catch {
      /* ignore */
    }
  }
}

function broadcastJsonToPublicTable(payload: unknown) {
  const raw = JSON.stringify(payload);
  for (const ws of publicTableSockets) {
    try {
      if (ws.readyState === OPEN) ws.send(raw);
    } catch {
      /* ignore */
    }
  }
}

export function getPublicTableViewerCount(): number {
  return publicTableSockets.size;
}

/** Подключения ленты акций + публичной таблицы номеров ≈ «на сайте» (без дубля user/chat-сокетов). */
export function getSiteOnlineCount(): number {
  return publicRaffleFeedSockets.size + publicTableSockets.size;
}

let siteOnlineBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
let lastSiteOnlineBroadcast = -1;

function broadcastSiteOnlineUpdated() {
  const n = getSiteOnlineCount();
  const payload = { type: "site_online_updated" as const, site_online_count: n };
  broadcastJsonToPublicRaffleFeed(payload);
  broadcastJsonToPublicTable(payload);
}

function scheduleSiteOnlineBroadcast() {
  if (siteOnlineBroadcastTimer != null) return;
  siteOnlineBroadcastTimer = setTimeout(() => {
    siteOnlineBroadcastTimer = null;
    const n = getSiteOnlineCount();
    if (n !== lastSiteOnlineBroadcast) {
      lastSiteOnlineBroadcast = n;
      broadcastSiteOnlineUpdated();
    }
  }, 50);
}

/** Всем пользователям: занятость номерков в акции изменилась (корзина / сетка на клиенте). */
export function broadcastRaffleGridUpdated(raffleId: number) {
  const rid = Math.floor(Number(raffleId));
  if (!Number.isFinite(rid) || rid < 1) return;
  const payload = JSON.stringify({ type: "raffle_grid_updated", raffle_id: rid });
  for (const set of userSockets.values()) {
    for (const ws of set) {
      try {
        if (ws.readyState === OPEN) ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
  broadcastJsonToPublicRaffleFeed({ type: "raffle_grid_updated", raffle_id: rid });
}

/** Уведомление всем клиентам: лента акций/статусы изменились */
export function broadcastRafflesFeedUpdated() {
  const payload = JSON.stringify({ type: "raffles_feed_updated" });
  for (const ws of adminSockets) {
    try {
      if (ws.readyState === OPEN) ws.send(payload);
    } catch {
      /* ignore */
    }
  }
  for (const set of userSockets.values()) {
    for (const ws of set) {
      try {
        if (ws.readyState === OPEN) ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
  broadcastJsonToPublicRaffleFeed({ type: "raffles_feed_updated" });
}

/** Периодическое напоминание: остаток свободных номерков в активной акции. */
export function broadcastRaffleFreeTicketsReminder(
  raffleId: number,
  freeCount: number,
  raffleTitle?: string,
) {
  const rid = Math.floor(Number(raffleId));
  const free = Math.max(0, Math.floor(Number(freeCount)));
  if (!Number.isFinite(rid) || rid < 1 || free < 1) return;
  const payload = JSON.stringify({
    type: "raffle_free_tickets_reminder",
    raffle_id: rid,
    free_count: free,
    raffle_title: String(raffleTitle ?? "").trim().slice(0, 180),
  });
  for (const set of userSockets.values()) {
    for (const ws of set) {
      try {
        if (ws.readyState === OPEN) ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
  broadcastJsonToPublicRaffleFeed({
    type: "raffle_free_tickets_reminder",
    raffle_id: rid,
    free_count: free,
    raffle_title: String(raffleTitle ?? "").trim().slice(0, 180),
  });
}

/** Явное оповещение о запуске акции (только по кнопке администратора). */
export function broadcastRaffleLaunchNotified(raffleId: number) {
  const rid = Math.floor(Number(raffleId));
  if (!Number.isFinite(rid) || rid < 1) return;
  const payload = JSON.stringify({ type: "raffle_launch_notified", raffle_id: rid });
  for (const set of userSockets.values()) {
    for (const ws of set) {
      try {
        if (ws.readyState === OPEN) ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
  broadcastJsonToPublicRaffleFeed({ type: "raffle_launch_notified", raffle_id: rid });
}

/** Уведомление всем клиентам: изменился флаг техработ на сайте */
export function broadcastMaintenanceStatusUpdated(enabled: boolean) {
  const payload = JSON.stringify({ type: "site_maintenance_updated", maintenance: Boolean(enabled) });
  for (const ws of adminSockets) {
    try {
      if (ws.readyState === OPEN) ws.send(payload);
    } catch {
      /* ignore */
    }
  }
  for (const set of userSockets.values()) {
    for (const ws of set) {
      try {
        if (ws.readyState === OPEN) ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
  broadcastJsonToPublicRaffleFeed({ type: "site_maintenance_updated", maintenance: Boolean(enabled) });
}

/** Уведомление клиентам: включён или выключен публичный блог */
/** Новый или обновлённый опубликованный пост в блоге — обновить счётчик непросмотренных в навигации. */
export function broadcastBlogPostsUpdated() {
  const payload = JSON.stringify({ type: "blog_posts_updated" });
  for (const set of userSockets.values()) {
    for (const ws of set) {
      try {
        if (ws.readyState === OPEN) ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
  broadcastJsonToPublicRaffleFeed({ type: "blog_posts_updated" });
}

export function broadcastBlogEnabledUpdated(enabled: boolean) {
  const payload = JSON.stringify({ type: "site_blog_enabled_updated", blog_enabled: Boolean(enabled) });
  for (const ws of adminSockets) {
    try {
      if (ws.readyState === OPEN) ws.send(payload);
    } catch {
      /* ignore */
    }
  }
  for (const set of userSockets.values()) {
    for (const ws of set) {
      try {
        if (ws.readyState === OPEN) ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
  broadcastJsonToPublicRaffleFeed({ type: "site_blog_enabled_updated", blog_enabled: Boolean(enabled) });
}

/** Фоновая музыка: настройки и плейлист изменились. */
export function broadcastSiteMusicUpdated(payload: {
  music_enabled: boolean;
  music_default_volume: number;
  music_playback_mode: "sequential" | "shuffle";
  tracks: Array<{ id: number; title: string; file_url: string; mime: string }>;
}) {
  const body = JSON.stringify({ type: "site_music_updated", ...payload });
  for (const ws of adminSockets) {
    try {
      if (ws.readyState === OPEN) ws.send(body);
    } catch {
      /* ignore */
    }
  }
  for (const set of userSockets.values()) {
    for (const ws of set) {
      try {
        if (ws.readyState === OPEN) ws.send(body);
      } catch {
        /* ignore */
      }
    }
  }
  broadcastJsonToPublicRaffleFeed({ type: "site_music_updated", ...payload });
}

/** Уведомление всем клиентам: изменилось количество онлайн в акции */
export function broadcastRaffleViewersUpdated(raffleId: number) {
  const rid = Math.floor(Number(raffleId));
  if (!Number.isFinite(rid) || rid < 1) return;
  const payload = JSON.stringify({ type: "raffle_viewers_updated", raffle_id: rid });
  for (const set of userSockets.values()) {
    for (const ws of set) {
      try {
        if (ws.readyState === OPEN) ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
  broadcastJsonToPublicRaffleFeed({ type: "raffle_viewers_updated", raffle_id: rid });
}

/** Пользователь печатает → всем админам (видно в выбранном диалоге) */
export function broadcastTypingUserToAdmins(userId: number, active: boolean) {
  const id = uid(userId);
  setUserTyping(id, active);
  const payload = JSON.stringify({
    type: "typing",
    userId: id,
    from: "user",
    active,
  });
  for (const ws of adminSockets) {
    try {
      if (ws.readyState === OPEN) ws.send(payload);
    } catch {
      /* ignore */
    }
  }
}

/** Админ печатает в диалоге userId → сокетам этого пользователя */
export function broadcastTypingStaffToUser(userId: number, active: boolean) {
  const id = uid(userId);
  if (!id) return;
  setStaffTypingForUser(id, active);
  const payload = JSON.stringify({
    type: "typing",
    from: "staff",
    active,
  });
  const set = userSockets.get(id);
  if (!set) return;
  for (const ws of set) {
    try {
      if (ws.readyState === OPEN) ws.send(payload);
    } catch {
      /* ignore */
    }
  }
}

function sendJson(ws: WebSocket, obj: unknown) {
  if (ws.readyState === OPEN) ws.send(JSON.stringify(obj));
}

async function routeUserSocketMessage(userId: number, raw: string) {
  let msg: { type?: string; body?: string; active?: boolean; attachment?: unknown };
  try {
    msg = JSON.parse(raw) as { type?: string; body?: string; active?: boolean; attachment?: unknown };
  } catch {
    return;
  }
  if (msg.type === "typing") {
    broadcastTypingUserToAdmins(userId, Boolean(msg.active));
    return;
  }
  if (msg.type !== "send" && msg.type !== "user_send") return;
  const text = String(msg.body ?? "").trim();
  const att = parseChatAttachmentFromMessage(msg.attachment);
  if (msg.attachment !== undefined && !att) return;
  if (!text && !att) return;
  if (text.length > 4000) return;
  const id = await insertSupportMessage(userId, text, false, att);
  const row = await getSupportMessageById(id);
  if (!row) return;
  const dto = messageToDto(row);
  broadcastChatMessage(userId, dto);
}

async function routeAdminSocketMessage(ws: WebSocket, raw: string) {
  let msg: { type?: string; body?: string; userId?: number; active?: boolean; attachment?: unknown };
  try {
    msg = JSON.parse(raw) as {
      type?: string;
      body?: string;
      userId?: number;
      active?: boolean;
      attachment?: unknown;
    };
  } catch {
    return;
  }
  if (msg.type === "typing") {
    const targetId = Number(msg.userId);
    if (!Number.isFinite(targetId)) return;
    if (!(await getUserById(targetId))) return;
    broadcastTypingStaffToUser(targetId, Boolean(msg.active));
    return;
  }
  if (msg.type !== "send" && msg.type !== "admin_send") return;
  const userId = Number(msg.userId);
  if (!Number.isFinite(userId)) return;
  const rawText = String(msg.body ?? "").trim();
  const att = parseChatAttachmentFromMessage(msg.attachment);
  if (msg.attachment !== undefined && !att) return;
  if (!rawText && !att) return;
  if (rawText.length > 4000) return;
  if (!(await getUserById(userId))) return;
  const text = rawText ? await applyStaffSupportGreetingForUser(userId, rawText) : rawText;
  const id = await insertSupportMessage(userId, text, true, att);
  await markThreadReadByStaff(userId);
  broadcastThreadReadByStaff(userId);
  const row = await getSupportMessageById(id);
  if (!row) return;
  const dto = messageToDto(row);
  broadcastChatMessage(userId, dto);
  notifyUserEmailStaffReply(userId, {
    body: text,
    attachmentName: att?.name ?? null,
    attachmentMime: att?.mime ?? null,
  });
}

export function attachWebSocket(wss: WebSocketServer) {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    void (async () => {
    const host = req.headers.host ?? "localhost";
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${host}`);
    } catch {
      ws.close();
      return;
    }
    const scope = url.searchParams.get("scope");
    if (scope === "public_raffle_feed") {
      publicRaffleFeedSockets.add(ws);
      sendJson(ws, {
        type: "ready",
        role: "public_raffle_feed",
        site_online_count: getSiteOnlineCount(),
      });
      scheduleSiteOnlineBroadcast();
      ws.on("close", () => {
        publicRaffleFeedSockets.delete(ws);
        scheduleSiteOnlineBroadcast();
      });
      return;
    }
    if (scope === "public_table") {
      publicTableSockets.add(ws);
      sendJson(ws, {
        type: "ready",
        role: "public_table",
        viewers_count: getPublicTableViewerCount(),
        site_online_count: getSiteOnlineCount(),
      });
      broadcastJsonToPublicTable({ type: "public_table_viewers_updated", viewers_count: getPublicTableViewerCount() });
      scheduleSiteOnlineBroadcast();
      ws.on("close", () => {
        publicTableSockets.delete(ws);
        broadcastJsonToPublicTable({ type: "public_table_viewers_updated", viewers_count: getPublicTableViewerCount() });
        scheduleSiteOnlineBroadcast();
      });
      return;
    }

    const token = url.searchParams.get("token");
    if (!token) {
      ws.close();
      return;
    }
    const user = await getUserBySessionTokenPg(token);
    if (!user) {
      ws.close();
      return;
    }
    if (user.blocked === 1) {
      ws.close();
      return;
    }

    const { isStaffRole } = await import("./admin-roles.js");
    if (isStaffRole(user.role)) {
      adminSockets.add(ws);
      sendJson(ws, { type: "ready", role: "admin" });
      ws.on("message", (data) => {
        routeAdminSocketMessage(ws, data.toString()).catch((err) => {
          console.error("[ws] admin message:", err instanceof Error ? err.message : err);
        });
      });
      ws.on("close", () => {
        adminSockets.delete(ws);
      });
      return;
    }

    addUserSocket(Number(user.id), ws);
    const messages = (await listSupportMessagesForUser(user.id)).map(messageToDto);
    sendJson(ws, { type: "ready", role: "user", messages });
    ws.on("message", (data) => {
      routeUserSocketMessage(user.id, data.toString()).catch((err) => {
        console.error("[ws] user message:", err instanceof Error ? err.message : err);
      });
    });
    ws.on("close", () => {
      removeUserSocket(Number(user.id), ws);
    });
    })().catch(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    });
  });
}
