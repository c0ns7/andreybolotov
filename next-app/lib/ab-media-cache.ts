/** Единый Cache API + prefetch для фото/видео сайта (блог, акции, чат). */
export const AB_MEDIA_CACHE_NAME = "ab_media_v1";

const MEDIA_PATH_RE = /^\/(uploads\/|img\/)/;
const MEDIA_EXT_RE = /\.(jpe?g|png|webp|gif|svg|ico|mp4|webm|mov|m4v)(\?|#|$)/i;

export function isAbMediaUrl(url: string): boolean {
  const raw = String(url || "").trim();
  if (!raw) return false;
  try {
    const u = raw.startsWith("http")
      ? new URL(raw)
      : new URL(raw, typeof window !== "undefined" ? window.location.origin : "https://andreybolotov.ru");
    if (u.origin !== (typeof window !== "undefined" ? window.location.origin : u.origin)) {
      return false;
    }
    return MEDIA_PATH_RE.test(u.pathname) || MEDIA_EXT_RE.test(u.pathname);
  } catch {
    return MEDIA_EXT_RE.test(raw);
  }
}

export function resolveAbMediaHref(url: string): string | null {
  const raw = String(url || "").trim();
  if (!raw || !isAbMediaUrl(raw)) return null;
  try {
    return raw.startsWith("http") ? raw : new URL(raw, window.location.origin).href;
  } catch {
    return null;
  }
}

export async function getCachedMediaBlobUrl(url: string): Promise<string | null> {
  if (typeof window === "undefined" || !("caches" in window)) return null;
  const href = resolveAbMediaHref(url);
  if (!href) return null;
  try {
    const cache = await caches.open(AB_MEDIA_CACHE_NAME);
    const hit = await cache.match(href);
    if (!hit) return null;
    const blob = await hit.blob();
    if (!blob.size) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function canCacheMediaResponse(res: Response): boolean {
  return res.status === 200 && !res.headers.get("content-range");
}

export async function storeMediaInCache(url: string, response: Response): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  const href = resolveAbMediaHref(url);
  if (!href || !canCacheMediaResponse(response)) return;
  try {
    const cache = await caches.open(AB_MEDIA_CACHE_NAME);
    await cache.put(href, response.clone());
    await trimMediaCache(cache, 200);
  } catch {
    /* ignore quota */
  }
}

async function trimMediaCache(cache: Cache, maxEntries: number): Promise<void> {
  try {
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const drop = keys.length - maxEntries;
    for (let i = 0; i < drop; i++) {
      await cache.delete(keys[i]!);
    }
  } catch {
    /* ignore */
  }
}

/** Сохранить медиа в кэш устройства (повторный просмотр без сети). */
export function prefetchMediaUrl(url: string): void {
  if (typeof window === "undefined") return;
  const href = resolveAbMediaHref(url);
  if (!href) return;

  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    try {
      navigator.serviceWorker.controller.postMessage({ type: "ab_prefetch_media", url: href });
    } catch {
      /* ignore */
    }
  }

  if (!("caches" in window)) return;
  void (async () => {
    try {
      const cache = await caches.open(AB_MEDIA_CACHE_NAME);
      if (await cache.match(href)) return;
      const res = await fetch(href, { credentials: "same-origin", mode: "same-origin" });
      if (res.ok) await storeMediaInCache(href, res);
    } catch {
      /* ignore */
    }
  })();
}

export function prefetchMediaList(urls: string[]): void {
  for (const u of urls) prefetchMediaUrl(u);
}
