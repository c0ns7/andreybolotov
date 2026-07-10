"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AB_ADMIN_MAX_LINK_LABEL,
  AB_ADMIN_MAX_URL_DEFAULT,
  AB_MAX_LOGO_SVG,
  AB_PASSWORD_RESET_ADMIN_TEXT,
  AB_PASSWORD_RESET_REQUIRED_FIELDS,
} from "../../../lib/ab-support-links";
import "./reset-password.css";

export default function ResetPasswordClient() {
  const [maxUrl, setMaxUrl] = useState(AB_ADMIN_MAX_URL_DEFAULT);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/site/status", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const url = String(data?.support_max_url || "").trim();
        if (!cancelled && url) setMaxUrl(url);
      } catch {
        /* keep default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="reset-pw-page">
      <Link className="reset-pw-back" href="/">
        <svg
          className="reset-pw-back__icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        На главную
      </Link>

      <div className="reset-pw-card forgot-password-modal">
        <div className="forgot-password-modal__icon" aria-hidden="true">
          <img src={AB_MAX_LOGO_SVG} alt="" width={40} height={40} />
        </div>
        <h1 className="reset-pw-title">Сброс пароля</h1>
        <p className="forgot-password-modal__lead">{AB_PASSWORD_RESET_ADMIN_TEXT}</p>
        <div className="forgot-password-modal__hint">
          <p className="forgot-password-modal__hint-title">В сообщении укажите:</p>
          <ul className="forgot-password-modal__list">
            {AB_PASSWORD_RESET_REQUIRED_FIELDS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <a className="btn btn--primary forgot-password-modal__cta reset-pw-cta" href={maxUrl} target="_blank" rel="noopener noreferrer">
          {AB_ADMIN_MAX_LINK_LABEL}
        </a>
      </div>
    </div>
  );
}
