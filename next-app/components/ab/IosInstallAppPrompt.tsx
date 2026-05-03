"use client";

import { Share, SquarePlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ab_ios_install_app_prompt_dismissed";

function isIosPhoneBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (!/iPhone|iPod/i.test(ua)) return false;
  if (/Android/i.test(ua)) return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return false;
  return true;
}

export default function IosInstallAppPrompt() {
  const [open, setOpen] = useState(false);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!isIosPhoneBrowser()) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(() => setOpen(true), 720);
    return () => window.clearTimeout(t);
  }, []);

  if (!open) return null;

  return (
    <div
      className="ab-ios-install-prompt"
      role="region"
      aria-label="Как добавить сайт на экран «Домой»"
      aria-labelledby="ab-ios-install-title"
    >
      <div className="ab-ios-install-prompt__enter">
        <div className="ab-ios-install-prompt__pulse">
          <div className="ab-ios-install-prompt__card">
            <div className="ab-ios-install-prompt__inner">
              <div className="ab-ios-install-prompt__head">
                <div className="ab-ios-install-prompt__brand">
                  <div className="ab-ios-install-prompt__icon-wrap" aria-hidden="true">
                    <img className="ab-ios-install-prompt__logo" src="/mascot/mascot_wave.svg" alt="" width={32} height={32} />
                  </div>
                  <div>
                    <h3 id="ab-ios-install-title" className="ab-ios-install-prompt__title">
                      Установите приложение
                    </h3>
                    <p className="ab-ios-install-prompt__sub">Быстрый доступ в один клик</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ab-ios-install-prompt__close"
                  onClick={dismiss}
                  aria-label="Закрыть"
                >
                  <X className="ab-ios-install-prompt__close-icon" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
              <div className="ab-ios-install-prompt__steps">
                <div className="ab-ios-install-prompt__step">
                  <div className="ab-ios-install-prompt__step-icon" aria-hidden="true">
                    <Share className="ab-ios-install-prompt__step-svg" strokeWidth={2} />
                  </div>
                  <span>
                    Нажмите <strong>«Поделиться»</strong> внизу Safari
                  </span>
                </div>
                <div className="ab-ios-install-prompt__step">
                  <div className="ab-ios-install-prompt__step-icon" aria-hidden="true">
                    <SquarePlus className="ab-ios-install-prompt__step-svg" strokeWidth={2} />
                  </div>
                  <span>
                    Выберите <strong>«На экран „Домой“»</strong>
                  </span>
                </div>
              </div>
              <p className="ab-ios-install-prompt__footer">andreybolotov.ru</p>
            </div>
          </div>
          <div className="ab-ios-install-prompt__notch" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
