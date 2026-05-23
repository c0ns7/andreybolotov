"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildEscapeNavigateUrl,
  buildPageUrlForExternalOpen,
  detectInAppBrowser,
  externalBrowserButtonLabel,
  IN_APP_AUTO_ESCAPE_KEY,
  inAppBrowserInstructions,
  type InAppBrowserInfo,
} from "../../lib/ab-in-app-browser";

export default function InAppBrowserGate() {
  const [info, setInfo] = useState<InAppBrowserInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [pageUrl, setPageUrl] = useState("https://andreybolotov.ru/");

  useEffect(() => {
    const detected = detectInAppBrowser();
    if (!detected) return;
    setInfo(detected);
    document.documentElement.classList.add("js-in-app-browser");
    try {
      setPageUrl(buildPageUrlForExternalOpen(window.location.href, detected.kind));
    } catch {
      setPageUrl(window.location.href);
    }

    let tried = false;
    try {
      tried = sessionStorage.getItem(IN_APP_AUTO_ESCAPE_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (tried) return;

    try {
      sessionStorage.setItem(IN_APP_AUTO_ESCAPE_KEY, "1");
    } catch {
      /* ignore */
    }

    const target = buildPageUrlForExternalOpen(window.location.href, detected.kind);
    const escapeUrl = buildEscapeNavigateUrl(target);
    window.setTimeout(() => {
      try {
        window.location.href = escapeUrl;
      } catch {
        /* gate stays visible */
      }
    }, 120);
  }, []);

  const escapeHref = useMemo(() => {
    if (!info) return pageUrl;
    return buildEscapeNavigateUrl(pageUrl);
  }, [info, pageUrl]);

  const openLabel = useMemo(() => externalBrowserButtonLabel(), []);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = pageUrl;
        ta.setAttribute("readonly", "true");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2200);
      } catch {
        /* ignore */
      }
    }
  }, [pageUrl]);

  if (!info) return null;

  return (
    <div className="ab-in-app-gate" role="dialog" aria-modal="true" aria-labelledby="ab-in-app-gate-title">
      <div className="ab-in-app-gate__card">
        <img className="ab-in-app-gate__logo" src="/logoandreybolotov.png" alt="" width={56} height={56} />
        <h2 id="ab-in-app-gate-title" className="ab-in-app-gate__title">
          Откройте сайт в обычном браузере
        </h2>
        <p className="ab-in-app-gate__lead">
          Вы открыли andreybolotov.ru через <strong>{info.label}</strong>. Во встроенном браузере кнопка «Войти» и
          оплата могут не работать.
        </p>
        <p className="ab-in-app-gate__hint">{inAppBrowserInstructions(info.kind)}</p>
        <a className="ab-in-app-gate__btn ab-in-app-gate__btn--primary" href={escapeHref}>
          {openLabel}
        </a>
        <button type="button" className="ab-in-app-gate__btn ab-in-app-gate__btn--ghost" onClick={() => void copyLink()}>
          {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
        </button>
      </div>
    </div>
  );
}
