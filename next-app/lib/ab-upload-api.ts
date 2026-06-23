/** Прямой URL API (общий). */
export function abDirectHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const o = (window as { __AB_HTTP_ORIGIN__?: string }).__AB_HTTP_ORIGIN__;
  return typeof o === "string" && o.trim() ? String(o).replace(/\/$/, "") : "";
}

/** Отдельный origin только для загрузок (поддомен api без Cloudflare, лимит 500M в nginx). */
export function abUploadHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const upload = (window as { __AB_UPLOAD_ORIGIN__?: string }).__AB_UPLOAD_ORIGIN__;
  if (typeof upload === "string" && upload.trim()) return upload.replace(/\/$/, "");
  return abDirectHttpOrigin();
}

export function blogUploadApiUrl(): string {
  const direct = abUploadHttpOrigin();
  if (direct) return `${direct}/api/admin/blog/upload`;
  return "/api/admin/blog/upload";
}

export function receiptUploadApiUrl(): string {
  const direct = abUploadHttpOrigin();
  if (direct) return `${direct}/api/raffles/receipt-upload`;
  return "/api/raffles/receipt-upload";
}

/** Таймаут XHR: отправка + запись файла на диск. */
export function uploadTimeoutMs(fileSizeBytes: number): number {
  const mb = Math.max(1, fileSizeBytes / (1024 * 1024));
  return Math.min(3_600_000, Math.round(180_000 + mb * 12_000));
}
