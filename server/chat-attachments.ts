/** Вложения в чате поддержки: загрузка и проверка URL из JSON WS/HTTP */

const CHAT_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "video/mp4": ".mp4",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
};

export function extForChatMime(mime: string): string | null {
  const m = mime.toLowerCase().split(";")[0].trim();
  return CHAT_EXT_BY_MIME[m] ?? null;
}

export function isAllowedChatAttachmentUrl(url: string): boolean {
  return /^\/uploads\/chat\/[a-zA-Z0-9._-]+$/.test(url);
}

export type ChatAttachment = { url: string; name: string; mime: string };

export function parseChatAttachmentFromMessage(raw: unknown): ChatAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const url = String(o.url ?? "").trim();
  const name = String(o.name ?? "файл").trim().slice(0, 255) || "файл";
  const mime = String(o.mime ?? "application/octet-stream").trim().slice(0, 120);
  if (!isAllowedChatAttachmentUrl(url)) return null;
  return { url, name, mime };
}
