import { abAuthHeaders } from "./ab-api";
import { abUploadHttpOrigin, receiptUploadApiUrl, uploadTimeoutMs } from "./ab-upload-api";

/** Лимит как на сервере (`/api/raffles/receipt-upload`). */
export const RECEIPT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Подсказка в UI: до этого размера без сжатия не трогаем картинку (меньше работы в браузере). */
const IMAGE_SKIP_COMPRESS_BELOW_BYTES = 1.25 * 1024 * 1024;

const MAX_IMAGE_LONG_EDGE = 1920;
const JPEG_QUALITY = 0.82;

const RECEIPT_UPLOAD_ATTEMPTS = 3;
const RECEIPT_POST_ATTEMPTS = 3;

export type ReceiptUploadPhase = "preparing" | "uploading" | "processing";

export type ReceiptUploadProgressHandler = (state: { percent: number; phase: ReceiptUploadPhase }) => void;

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
    msg.includes("network request failed") ||
    msg.includes("таймаут") ||
    msg.includes("timeout")
  );
}

function isHeicLikeType(type: string): boolean {
  const t = type.toLowerCase();
  return t === "image/heic" || t === "image/heif" || t === "image/heic-sequence" || t === "image/heif-sequence";
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
  if (!type.startsWith("image/") && !isHeicLikeType(type)) return file;
  if (file.size > 0 && file.size < IMAGE_SKIP_COMPRESS_BELOW_BYTES && !isHeicLikeType(type)) return file;

  let img: HTMLImageElement;
  try {
    img = await loadImageFromFile(file);
  } catch {
    if (isHeicLikeType(type)) {
      throw new Error("Не удалось открыть фото HEIC. Сохраните скриншот в «Фото» как JPEG или выберите PDF.");
    }
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
  if (!isHeicLikeType(type) && blob.size >= file.size * 0.97) return file;

  const base = file.name.replace(/\.[^.\\/]+$/, "").trim() || "chek";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

function uploadErrorMessage(status: number, payload: Record<string, unknown>): string {
  if (status === 413) {
    return (
      String(payload.error || "") ||
      "Файл слишком большой для сервера. Сожмите фото или задайте NEXT_PUBLIC_AB_UPLOAD_ORIGIN (см. deploy/nginx-upload-location.conf)."
    );
  }
  if (status === 0) {
    return abUploadHttpOrigin()
      ? "Не удалось связаться с сервером загрузок. Проверьте интернет или отключите VPN."
      : "Сервер не ответил. Проверьте интернет и попробуйте снова.";
  }
  return String(payload.error || "Не удалось загрузить файл. Попробуйте ещё раз.");
}

async function postReceiptUploadOnce(
  file: File,
  onProgress?: ReceiptUploadProgressHandler,
): Promise<Record<string, unknown>> {
  const fd = new FormData();
  fd.append("file", file);
  const uploadUrl = receiptUploadApiUrl();

  if (!onProgress) {
    const up = await fetch(uploadUrl, { method: "POST", headers: abAuthHeaders(), body: fd });
    const uploadData = (await up.json().catch(() => ({}))) as Record<string, unknown>;
    if (!up.ok) {
      throw new Error(uploadErrorMessage(up.status, uploadData));
    }
    return uploadData;
  }

  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.timeout = uploadTimeoutMs(file.size);
    const headers = abAuthHeaders();
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, String(v));
    }
    const markProcessing = () => {
      onProgress({ percent: 95, phase: "processing" });
    };
    xhr.upload.onprogress = (event) => {
      const raw =
        event.lengthComputable && event.total > 0
          ? event.loaded / event.total
          : file.size > 0
            ? event.loaded / file.size
            : 0.05;
      const percent = Math.max(0, Math.min(94, Math.round(raw * 100)));
      onProgress({ percent, phase: "uploading" });
    };
    xhr.upload.onload = markProcessing;
    xhr.onerror = () => reject(new Error("Failed to fetch"));
    xhr.onabort = () => reject(new Error("Failed to fetch"));
    xhr.ontimeout = () => reject(new Error("Таймаут загрузки. Проверьте интернет и попробуйте снова."));
    xhr.onload = () => {
      let payload: Record<string, unknown> = {};
      try {
        payload = (JSON.parse(String(xhr.responseText || "{}")) as Record<string, unknown>) || {};
      } catch {
        payload = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress({ percent: 100, phase: "uploading" });
        resolve(payload);
        return;
      }
      reject(new Error(uploadErrorMessage(xhr.status, payload)));
    };
    xhr.send(fd);
  });
}

/** Загрузка чека: сжатие картинки (по возможности) + до 3 попыток при сетевом сбое. */
export async function uploadReceiptFile(file: File, onProgress?: ReceiptUploadProgressHandler): Promise<Record<string, unknown>> {
  onProgress?.({ percent: 0, phase: "preparing" });
  await sleep(0);
  const prepared = await prepareReceiptFileForUpload(file);
  const bad = validateReceiptFileForUpload(prepared);
  if (bad) throw new Error(bad);
  onProgress?.({ percent: 0, phase: "uploading" });

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
  const bodyPayload = { ...payload };
  if (typeof bodyPayload.url === "string") {
    bodyPayload.url = String(bodyPayload.url).split("?")[0] || "";
  }
  for (let attempt = 0; attempt < RECEIPT_POST_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));
    try {
      return await fetch("/api/raffles/orders/" + String(orderId) + "/receipt", {
        method: "POST",
        headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });
    } catch (e) {
      lastErr = e;
      if (!isNetworkFetchError(e) || attempt === RECEIPT_POST_ATTEMPTS - 1) throw e;
    }
  }
  throw lastErr;
}

export function receiptUploadProgressLabel(state: { percent: number; phase: ReceiptUploadPhase }): string {
  if (state.phase === "preparing") return "Подготовка фото…";
  if (state.phase === "processing") return "Сохранение на сервере…";
  return `Загрузка: ${state.percent}%`;
}
