export type InAppBrowserKind = "telegram" | "vk" | "max";

export type InAppBrowserInfo = {
  kind: InAppBrowserKind;
  label: string;
};

const IN_APP_UA: Array<{ kind: InAppBrowserKind; label: string; re: RegExp }> = [
  { kind: "telegram", label: "Telegram", re: /Telegram/i },
  { kind: "vk", label: "ВКонтакте", re: /VKClient|VKApp|VKAndroid|VK\/[\d.]+|VkApp|vk\.com/i },
  { kind: "max", label: "MAX", re: /\bMax\/|MaxApp|OnemeApp|OKApp|OKAndroid/i },
];

export function detectInAppBrowser(userAgent?: string): InAppBrowserInfo | null {
  const ua = String(userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "") ?? "");
  if (!ua) return null;
  for (const row of IN_APP_UA) {
    if (row.re.test(ua)) return { kind: row.kind, label: row.label };
  }
  return null;
}

export function isIosDevice(userAgent?: string): boolean {
  const ua = String(userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "") ?? "");
  return /iPhone|iPad|iPod/i.test(ua) && !/Android/i.test(ua);
}

export function isAndroidDevice(userAgent?: string): boolean {
  const ua = String(userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "") ?? "");
  return /Android/i.test(ua);
}

/** URL страницы с параметрами для Telegram (openExternalBrowser). */
export function buildPageUrlForExternalOpen(currentHref: string, kind: InAppBrowserKind): string {
  if (kind !== "telegram") return currentHref;
  try {
    const u = new URL(currentHref);
    u.searchParams.set("openExternalBrowser", "1");
    return u.toString();
  } catch {
    return currentHref;
  }
}

/** Ссылка для перехода во внешний браузер (Safari / Chrome / системный). */
export function buildEscapeNavigateUrl(pageUrl: string, userAgent?: string): string {
  const ua = String(userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "") ?? "");
  if (isIosDevice(ua)) {
    const stripped = pageUrl.replace(/^https:\/\//i, "");
    return `x-safari-https://${stripped}`;
  }
  if (isAndroidDevice(ua)) {
    try {
      const u = new URL(pageUrl);
      const path = `${u.host}${u.pathname}${u.search}${u.hash}`;
      return (
        `intent://${path}#Intent;scheme=https;action=android.intent.action.VIEW;` +
        `category=android.intent.category.BROWSABLE;` +
        `S.browser_fallback_url=${encodeURIComponent(pageUrl)};end`
      );
    } catch {
      return pageUrl;
    }
  }
  return pageUrl;
}

export function externalBrowserButtonLabel(userAgent?: string): string {
  return isIosDevice(userAgent) ? "Открыть в Safari" : "Открыть в браузере";
}

export function inAppBrowserInstructions(kind: InAppBrowserKind): string {
  if (kind === "telegram") {
    return "В Telegram нажмите ⋮ вверху → «Открыть в Safari» или «Открыть во внешнем браузере».";
  }
  if (kind === "vk") {
    return "Во ВКонтакте нажмите ⋮ → «Открыть в браузере».";
  }
  return "В MAX нажмите ⋮ (меню) → «Открыть в браузере», либо скопируйте ссылку и вставьте в Safari или Chrome.";
}

export const IN_APP_AUTO_ESCAPE_KEY = "ab_inapp_auto_escape_v1";
