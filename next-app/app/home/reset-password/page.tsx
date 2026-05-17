import type { Metadata } from "next";
import Link from "next/link";
import {
  AB_ADMIN_MAX_LINK_LABEL,
  AB_ADMIN_MAX_URL,
  AB_PASSWORD_RESET_ADMIN_TEXT,
} from "../../../lib/ab-support-links";
import "./reset-password.css";

export const metadata: Metadata = {
  title: "Сброс пароля",
  description: "Обратитесь к администратору для сброса пароля.",
};

export default function ResetPasswordPage() {
  return (
    <div className="reset-pw-page">
      <Link className="reset-pw-back" href="/home">
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

      <div className="reset-pw-card">
        <div className="reset-pw-card__accent" aria-hidden="true" />
        <div className="reset-pw-hero reset-pw-hero--warn" aria-hidden="true">
          <div className="reset-pw-hero__glow reset-pw-hero__glow--warn" />
          <div className="reset-pw-hero__icon reset-pw-hero__icon--warn">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        </div>
        <h1 className="reset-pw-title">Сброс пароля</h1>
        <p className="reset-pw-lead">{AB_PASSWORD_RESET_ADMIN_TEXT}</p>
        <p className="reset-pw-lead reset-pw-lead--tight">Я пользуюсь мессенджером MAX. Присоединяйся!</p>
        <a className="btn btn--primary reset-pw-cta" href={AB_ADMIN_MAX_URL} target="_blank" rel="noopener noreferrer">
          {AB_ADMIN_MAX_LINK_LABEL}
        </a>
      </div>
    </div>
  );
}
