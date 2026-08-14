export const YANDEX_BROWSER_DOWNLOAD_URL = "https://browser.yandex.ru/";

export function isYandexBrowser(userAgent?: string): boolean {
  const ua = String(userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "") ?? "");
  return /YaBrowser/i.test(ua);
}

export function isAndroidDevice(userAgent?: string): boolean {
  const ua = String(userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "") ?? "");
  return /Android/i.test(ua);
}

export function isIosDevice(userAgent?: string): boolean {
  const ua = String(userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "") ?? "");
  return /iPhone|iPad|iPod/i.test(ua) && !/Android/i.test(ua);
}

function normalizeHttpUrl(raw: string): string {
  const url = String(raw || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url.replace(/^\/+/, "")}`;
}

/** Deep link / intent для открытия bank URL в Яндекс Браузере. */
export function buildYandexBrowserDeepLink(targetUrl: string, userAgent?: string): string {
  const url = normalizeHttpUrl(targetUrl);
  if (!url) return YANDEX_BROWSER_DOWNLOAD_URL;
  const ua = String(userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "") ?? "");
  if (isIosDevice(ua)) {
    // iOS: полный https-URL в encoded-виде — иначе «https» становится hostname или грузится по http
    return `yandexbrowser-open-url://${encodeURIComponent(url)}`;
  }
  if (isAndroidDevice(ua)) {
    try {
      const u = new URL(url);
      const path = `${u.host}${u.pathname}${u.search}${u.hash}`;
      return (
        `intent://${path}#Intent;scheme=https;package=com.yandex.browser;` +
        `action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`
      );
    } catch {
      return `yandexbrowser://open?url=${encodeURIComponent(url)}`;
    }
  }
  return `yandexbrowser://open?url=${encodeURIComponent(url)}`;
}

/** Открывает страницу банка через Яндекс Браузер (или напрямую, если уже в нём). */
export function openPaymentInYandexBrowser(targetUrl: string, userAgent?: string): boolean {
  const url = normalizeHttpUrl(targetUrl);
  if (!url) return false;
  if (typeof window === "undefined") return false;
  const ua = String(userAgent ?? navigator.userAgent ?? "");
  if (isYandexBrowser(ua)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }
  const deepLink = buildYandexBrowserDeepLink(url, ua);
  const anchor = document.createElement("a");
  anchor.href = deepLink;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}

export async function copyPaymentUrlToClipboard(targetUrl: string): Promise<boolean> {
  const url = normalizeHttpUrl(targetUrl);
  if (!url || typeof navigator === "undefined") return false;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export const RAFFLE_BANK_BROWSER_NOTICE_HTML = [
  "Теперь в России банковские сайты ограничены через зарубежные браузеры (Safari, Chrome и т.д.).",
  "Чтобы оплата прошла корректно — и ваши банковские сайты снова заработали — рекомендуем использовать <strong>Яндекс Браузер</strong> (рекомендация РКН).",
  "Мы добавили рекомендацию по корректной оплате непосредственно на этапе оплаты — просто следуйте инструкции на сайте.",
].join(" ");
