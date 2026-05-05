import { abAuthHeaders } from "./ab-api";

/** Лимит как на сервере (`/api/raffles/receipt-upload`). */
export const RECEIPT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Подсказка в UI: до этого размера без сжатия не трогаем картинку (меньше работы в браузере). */
const IMAGE_SKIP_COMPRESS_BELOW_BYTES = 1.25 * 1024 * 1024;

const MAX_IMAGE_LONG_EDGE = 1920;
const JPEG_QUALITY = 0.82;

const RECEIPT_UPLOAD_ATTEMPTS = 3;
const RECEIPT_POST_ATTEMPTS = 3;
export type ReceiptUploadProgressHandler = (percent: number) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attemptIndex: number): number {
  if (attemptIndex <= 0) return 0;
  return 900 * Math.pow(2, attemptIndex - 1);
}

export const RECEIPT_NETWORK_MODAL_TITLE = "Нет связи с сервером";

export const RECEIPT_NETWORK_MODAL_TEXT =
  "Проверьте интернет или отключите VPN. Это не ошибка банка — запрос не дошёл до сайта. Нажмите «Повторить».";

export function isNetworkFetchError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message || "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("network request failed")
  );
}

/** `null` если файл ок, иначе текст ошибки для пользователя. */
export function validateReceiptFileForUpload(file: File): string | null {
  if (!file || !file.size) return "Выберите файл: фото чека или PDF.";
  if (file.size > RECEIPT_UPLOAD_MAX_BYTES) {
    return `Файл больше ${Math.round(RECEIPT_UPLOAD_MAX_BYTES / (1024 * 1024))} МБ. Сожмите фото или выберите другой файл.`;
  }
  return null;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      resolve(im);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("IMAGE_DECODE"));
    };
    im.src = url;
  });
}

/**
 * Для фото — уменьшает разрешение и перекодирует в JPEG (часто сильно легче для загрузки).
 * PDF и неподдерживаемые типы возвращаются как есть.
 */
export async function prepareReceiptFileForUpload(file: File): Promise<File> {
  const type = (file.type || "").toLowerCase().split(";")[0].trim();
  if (type === "application/pdf") return file;
  if (!type.startsWith("image/")) return file;
  if (file.size > 0 && file.size < IMAGE_SKIP_COMPRESS_BELOW_BYTES) return file;

  let img: HTMLImageElement;
  try {
    img = await loadImageFromFile(file);
  } catch {
    return file;
  }

  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (!w || !h) return file;

  const scale = Math.min(1, MAX_IMAGE_LONG_EDGE / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
    } catch {
      resolve(null);
    }
  });
  if (!blob || blob.size === 0) return file;
  if (blob.size >= file.size * 0.97) return file;

  const base = file.name.replace(/\.[^.\\/]+$/, "").trim() || "chek";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

async function postReceiptUploadOnce(file: File, onProgress?: ReceiptUploadProgressHandler): Promise<Record<string, unknown>> {
  const fd = new FormData();
  fd.append("file", file);
  if (!onProgress) {
    const up = await fetch("/api/raffles/receipt-upload", { method: "POST", headers: abAuthHeaders(), body: fd });
    const uploadData = (await up.json().catch(() => ({}))) as Record<string, unknown>;
    if (!up.ok) {
      throw new Error(String(uploadData.error || "Не удалось загрузить файл. Попробуйте ещё раз."));
    }
    return uploadData;
  }
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/raffles/receipt-upload");
    const headers = abAuthHeaders();
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, String(v));
    }
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress(percent);
    };
    xhr.onerror = () => reject(new Error("Failed to fetch"));
    xhr.onabort = () => reject(new Error("Failed to fetch"));
    xhr.onload = () => {
      let payload: Record<string, unknown> = {};
      try {
        payload = (JSON.parse(String(xhr.responseText || "{}")) as Record<string, unknown>) || {};
      } catch {
        payload = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve(payload);
        return;
      }
      reject(new Error(String(payload.error || "Не удалось загрузить файл. Попробуйте ещё раз.")));
    };
    xhr.send(fd);
  });
}

/** Загрузка чека: сжатие картинки (по возможности) + до 3 попыток при сетевом сбое. */
export async function uploadReceiptFile(file: File, onProgress?: ReceiptUploadProgressHandler): Promise<Record<string, unknown>> {
  const prepared = await prepareReceiptFileForUpload(file);
  const bad = validateReceiptFileForUpload(prepared);
  if (bad) throw new Error(bad);

  let lastErr: unknown;
  for (let attempt = 0; attempt < RECEIPT_UPLOAD_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));
    try {
      return await postReceiptUploadOnce(prepared, onProgress);
    } catch (e) {
      lastErr = e;
      if (!isNetworkFetchError(e) || attempt === RECEIPT_UPLOAD_ATTEMPTS - 1) throw e;
    }
  }
  throw lastErr;
}

/** Привязка чека к заказу: до 3 попыток при сетевом сбое. */
export async function postReceiptWithRetries(orderId: number, payload: Record<string, unknown>): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RECEIPT_POST_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));
    try {
      return await fetch("/api/raffles/orders/" + String(orderId) + "/receipt", {
        method: "POST",
        headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      lastErr = e;
      if (!isNetworkFetchError(e) || attempt === RECEIPT_POST_ATTEMPTS - 1) throw e;
    }
  }
  throw lastErr;
}
