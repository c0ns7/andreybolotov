/** Прямой URL API для больших multipart-загрузок (минуя Next/nginx). */
export function abDirectHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const o = (window as { __AB_HTTP_ORIGIN__?: string }).__AB_HTTP_ORIGIN__;
  return typeof o === "string" && o.trim() ? String(o).replace(/\/$/, "") : "";
}

export function blogUploadApiUrl(): string {
  const direct = abDirectHttpOrigin();
  if (direct) return `${direct}/api/admin/blog/upload`;
  return "/api/admin/blog/upload";
}

/** Таймаут XHR: отправка + запись файла на диск. */
export function uploadTimeoutMs(fileSizeBytes: number): number {
  const mb = Math.max(1, fileSizeBytes / (1024 * 1024));
  return Math.min(3_600_000, Math.round(180_000 + mb * 12_000));
}
