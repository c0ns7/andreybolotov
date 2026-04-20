import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  getSupportMessageById,
  getUserById,
  getUserBySessionToken,
  insertSupportMessage,
  listSupportMessagesForUser,
  markThreadReadByStaff,
  messageToDto,
} from "./db.js";
import { parseChatAttachmentFromMessage } from "./chat-attachments.js";
import { notifyUserEmailStaffReply } from "./notify-email.js";
import { setStaffTypingForUser, setUserTyping } from "./typing-state.js";

const OPEN = WebSocket.OPEN;

const adminSockets = new Set<WebSocket>();
const userSockets = new Map<number, Set<WebSocket>>();
/** Анонимные клиенты (страница /numbers): только события сетки и ленты акций */
const publicRaffleFeedSockets = new Set<WebSocket>();

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

function routeUserSocketMessage(userId: number, raw: string) {
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
  const id = insertSupportMessage(userId, text, false, att);
  const row = getSupportMessageById(id);
  if (!row) return;
  const dto = messageToDto(row);
  broadcastChatMessage(userId, dto);
}

function routeAdminSocketMessage(ws: WebSocket, raw: string) {
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
    if (!getUserById(targetId)) return;
    broadcastTypingStaffToUser(targetId, Boolean(msg.active));
    return;
  }
  if (msg.type !== "send" && msg.type !== "admin_send") return;
  const userId = Number(msg.userId);
  if (!Number.isFinite(userId)) return;
  const text = String(msg.body ?? "").trim();
  const att = parseChatAttachmentFromMessage(msg.attachment);
  if (msg.attachment !== undefined && !att) return;
  if (!text && !att) return;
  if (text.length > 4000) return;
  if (!getUserById(userId)) return;
  const id = insertSupportMessage(userId, text, true, att);
  markThreadReadByStaff(userId);
  broadcastThreadReadByStaff(userId);
  const row = getSupportMessageById(id);
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
      sendJson(ws, { type: "ready", role: "public_raffle_feed" });
      ws.on("close", () => {
        publicRaffleFeedSockets.delete(ws);
      });
      return;
    }

    const token = url.searchParams.get("token");
    if (!token) {
      ws.close();
      return;
    }
    const user = getUserBySessionToken(token);
    if (!user) {
      ws.close();
      return;
    }
    if (user.blocked === 1) {
      ws.close();
      return;
    }

    if (user.role === "admin") {
      adminSockets.add(ws);
      sendJson(ws, { type: "ready", role: "admin" });
      ws.on("message", (data) => {
        routeAdminSocketMessage(ws, data.toString());
      });
      ws.on("close", () => {
        adminSockets.delete(ws);
      });
      return;
    }

    addUserSocket(Number(user.id), ws);
    const messages = listSupportMessagesForUser(user.id).map(messageToDto);
    sendJson(ws, { type: "ready", role: "user", messages });
    ws.on("message", (data) => {
      routeUserSocketMessage(user.id, data.toString());
    });
    ws.on("close", () => {
      removeUserSocket(Number(user.id), ws);
    });
  });
}
