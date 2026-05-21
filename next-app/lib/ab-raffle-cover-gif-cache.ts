import { AB_MEDIA_CACHE_NAME, storeMediaInCache } from "./ab-media-cache";

const META_PREFIX = "ab_raffle_gif_meta_v1";
const CACHE_NAME = AB_MEDIA_CACHE_NAME;

/** GIF или MP4/WebM/MOV в поле cover_gif_url. */
export function isRaffleCoverAnimVideo(url: string): boolean {
  const path = String(url || "")
    .trim()
    .toLowerCase()
    .split("?")[0]
    .split("#")[0];
  if (!path) return false;
  return /\.(mp4|webm|mov)$/i.test(path);
}

export type RaffleGifMeta = {
  url: string;
  updatedAt: number;
};

function metaStorageKey(raffleId: number): string {
  return `${META_PREFIX}:${Math.floor(Number(raffleId) || 0)}`;
}

export function readRaffleGifMeta(raffleId: number): RaffleGifMeta | null {
  if (typeof window === "undefined") return null;
  const rid = Math.floor(Number(raffleId) || 0);
  if (rid < 1) return null;
  try {
    const raw = localStorage.getItem(metaStorageKey(rid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { url?: unknown; updatedAt?: unknown };
    const url = String(parsed?.url ?? "").trim();
    const updatedAt = Math.floor(Number(parsed?.updatedAt) || 0);
    if (!url) return null;
    return { url, updatedAt };
  } catch {
    return null;
  }
}

export function writeRaffleGifMeta(raffleId: number, meta: RaffleGifMeta): void {
  if (typeof window === "undefined") return;
  const rid = Math.floor(Number(raffleId) || 0);
  if (rid < 1) return;
  try {
    localStorage.setItem(metaStorageKey(rid), JSON.stringify(meta));
  } catch {
    /* ignore quota */
  }
}

export function clearRaffleGifMeta(raffleId: number): void {
  if (typeof window === "undefined") return;
  const rid = Math.floor(Number(raffleId) || 0);
  if (rid < 1) return;
  try {
    localStorage.removeItem(metaStorageKey(rid));
  } catch {
    /* ignore */
  }
}

export function isRaffleGifMetaCurrent(
  meta: RaffleGifMeta | null,
  gifUrl: string,
  updatedAt: number,
): boolean {
  const url = String(gifUrl || "").trim();
  if (!url || !meta) return false;
  const ts = Math.floor(Number(updatedAt) || 0);
  return meta.url === url && meta.updatedAt === ts;
}

async function blobUrlFromCache(url: string): Promise<string | null> {
  if (typeof window === "undefined" || !("caches" in window)) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url, { ignoreSearch: false });
    if (!hit) return null;
    const blob = await hit.blob();
    if (!blob.size) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

async function storeGifInCache(url: string, response: Response): Promise<void> {
  await storeMediaInCache(url, response);
}

/** Фоновая подгрузка GIF/видео: сначала статичная обложка, затем swap из кэша или сети. */
export function preloadRaffleCoverGif(opts: {
  raffleId: number;
  gifUrl: string;
  updatedAt: number;
  onLoaded: (displayUrl: string, isVideo: boolean) => void;
}): () => void {
  const raffleId = Math.floor(Number(opts.raffleId) || 0);
  const gifUrl = String(opts.gifUrl || "").trim();
  const updatedAt = Math.floor(Number(opts.updatedAt) || 0);
  if (raffleId < 1 || !gifUrl) return () => {};

  let cancelled = false;
  let revokeUrl: string | null = null;

  const finish = (blobUrl: string) => {
    if (cancelled) {
      if (blobUrl.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    revokeUrl = blobUrl.startsWith("blob:") ? blobUrl : null;
    opts.onLoaded(blobUrl, isRaffleCoverAnimVideo(gifUrl));
  };

  void (async () => {
    const meta = readRaffleGifMeta(raffleId);
    if (isRaffleGifMetaCurrent(meta, gifUrl, updatedAt)) {
      const cached = await blobUrlFromCache(gifUrl);
      if (cached) {
        finish(cached);
        return;
      }
    } else {
      clearRaffleGifMeta(raffleId);
    }

    try {
      const res = await fetch(gifUrl, { credentials: "same-origin", cache: "force-cache" });
      if (!res.ok || cancelled) return;
      await storeGifInCache(gifUrl, res);
      const blob = await res.blob();
      if (cancelled || !blob.size) return;
      writeRaffleGifMeta(raffleId, { url: gifUrl, updatedAt });
      finish(URL.createObjectURL(blob));
    } catch {
      /* тихо: остаётся статичная обложка */
    }
  })();

  return () => {
    cancelled = true;
    if (revokeUrl) {
      try {
        URL.revokeObjectURL(revokeUrl);
      } catch {
        /* ignore */
      }
      revokeUrl = null;
    }
  };
}
