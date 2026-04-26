import type { Metadata } from "next";
import Script from "next/script";
import ResetPasswordClient from "./ResetPasswordClient";
import "./reset-password.css";

export const metadata: Metadata = {
  title: "Новый пароль",
  description: "Установите новый пароль по ссылке из письма.",
};

export default function ResetPasswordPage() {
  return (
    <>
      <Script id="reset-pw-theme" strategy="beforeInteractive">
        {`try {
          if (localStorage.getItem("ab_theme") === "dark") document.documentElement.classList.add("theme-dark");
        } catch (e) {}`}
      </Script>
      <div className="reset-pw-page">
        <a className="reset-pw-back" href="/home">
          <svg className="reset-pw-back__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          На главную
        </a>

        <div className="reset-pw-card">
          <div className="reset-pw-card__accent" aria-hidden="true" />

          <div id="reset-pw-state-form">
            <div className="reset-pw-hero" aria-hidden="true">
              <div className="reset-pw-hero__glow" />
              <div className="reset-pw-hero__icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
            </div>
            <h1 className="reset-pw-title">Новый пароль</h1>
            <p id="reset-pw-lead" className="reset-pw-lead">
              Придумайте пароль для входа по телефону — не короче 6 символов.
            </p>
            <div id="reset-pw-error" className="reset-pw-alert reset-pw-alert--err" role="alert" hidden>
              <svg className="reset-pw-alert__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <span id="reset-pw-error-text" />
            </div>
            <form id="form-reset-pw" className="reset-pw-form" noValidate>
              <div className="reset-pw-field">
                <label className="reset-pw-field__label" htmlFor="reset-pw-pass">
                  <span className="reset-pw-field__icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                    </svg>
                  </span>
                  Пароль
                </label>
                <input
                  className="input reset-pw-field__input"
                  type="password"
                  id="reset-pw-pass"
                  name="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  placeholder="••••••••"
                />
              </div>
              <div className="reset-pw-field">
                <label className="reset-pw-field__label" htmlFor="reset-pw-pass2">
                  <span className="reset-pw-field__icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l.8-.8a1 1 0 0 0 0-1.4l-2.3-2.3" />
                      <path d="M9 11l6-6a2.1 2.1 0 0 1 2.8 0L19 6.2a2.1 2.1 0 0 1 0 2.8l-6 6" />
                      <path d="m7 13-4 4v3h3l4-4" />
                    </svg>
                  </span>
                  Повторите пароль
                </label>
                <input
                  className="input reset-pw-field__input"
                  type="password"
                  id="reset-pw-pass2"
                  name="password2"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  placeholder="••••••••"
                />
              </div>
              <button type="submit" className="btn btn--primary reset-pw-submit" id="reset-pw-btn">
                <svg className="reset-pw-submit__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                Сохранить пароль
              </button>
            </form>
          </div>

          <div id="reset-pw-state-bad" className="reset-pw-state-bad" hidden>
            <div className="reset-pw-hero reset-pw-hero--warn" aria-hidden="true">
              <div className="reset-pw-hero__glow reset-pw-hero__glow--warn" />
              <div className="reset-pw-hero__icon reset-pw-hero__icon--warn">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <path d="M12 9v4M12 17h.01" />
                </svg>
              </div>
            </div>
            <h1 className="reset-pw-title">Ссылка недействительна</h1>
            <p className="reset-pw-lead">Запросите новое письмо в окне входа — пункт «Забыли пароль?».</p>
            <a className="btn btn--primary reset-pw-cta" href="/home">
              Перейти ко входу
            </a>
          </div>

          <div id="reset-pw-done" className="reset-pw-done" hidden>
            <div className="reset-pw-hero reset-pw-hero--ok" aria-hidden="true">
              <div className="reset-pw-hero__glow reset-pw-hero__glow--ok" />
              <div className="reset-pw-hero__icon reset-pw-hero__icon--ok">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
            </div>
            <h1 className="reset-pw-title">Готово</h1>
            <p className="reset-pw-lead reset-pw-lead--tight">Пароль обновлён. Войдите с новым паролем.</p>
            <a className="btn btn--primary reset-pw-cta" href="/home">
              <svg className="reset-pw-submit__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Войти в приложение
            </a>
          </div>
        </div>
      </div>
      <ResetPasswordClient />
    </>
  );
}
