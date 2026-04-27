import type { Metadata } from "next";
import Link from "next/link";
import SettingsDockClient from "../../../components/ab/SettingsDockClient";
import SettingsPageClient from "../../../components/ab/SettingsPageClient";

export const metadata: Metadata = {
  title: "Настройки",
  description: "Пароль, тема, уведомления на почту и доступность.",
};

export default function HomeSettingsPage() {
  return (
    <>
      <div className="app-shell app-shell--with-tabbar" id="app-shell">
        <div className="settings-page screen home-screen" id="settings-page-root">
          <div className="settings-page__inner home-inner">
            <header className="settings-page__head">
              <Link href="/home" className="settings-page__back" aria-label="Назад в приложение">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </Link>
              <h1 className="settings-page__title">Настройки</h1>
            </header>

            <nav className="settings-tabs" role="tablist" aria-label="Разделы настроек">
              <button type="button" className="settings-tab" role="tab" id="tab-settings-password" data-tab="password" aria-selected="true" aria-controls="settings-panel-password">
                <span className="settings-tab__icon" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="10" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <span>Пароль</span>
              </button>
              <button type="button" className="settings-tab" role="tab" id="tab-settings-theme" data-tab="theme" aria-selected="false" aria-controls="settings-panel-theme" tabIndex={-1}>
                <span className="settings-tab__icon" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="13.5" cy="6.5" r=".5" />
                    <circle cx="17.5" cy="10.5" r=".5" />
                    <circle cx="8.5" cy="7.5" r=".5" />
                    <circle cx="6.5" cy="12.5" r=".5" />
                    <path d="M12 22a10 10 0 1 1 0-20 7 7 0 0 1 0 14h-1a2 2 0 0 0 0 4z" />
                  </svg>
                </span>
                <span>Тема</span>
              </button>
              <button type="button" className="settings-tab" role="tab" id="tab-settings-notify" data-tab="notify" aria-selected="false" aria-controls="settings-panel-notify" tabIndex={-1}>
                <span className="settings-tab__icon" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="m3 7 9 6 9-6" />
                  </svg>
                </span>
                <span>Почта</span>
              </button>
              <button type="button" className="settings-tab" role="tab" id="tab-settings-a11y" data-tab="a11y" aria-selected="false" aria-controls="settings-panel-a11y" tabIndex={-1}>
                <span className="settings-tab__icon" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </span>
                <span>Доступность</span>
              </button>
            </nav>

            <div id="settings-panel-password" className="settings-tab-panel" role="tabpanel" aria-labelledby="tab-settings-password">
              <div className="settings-card">
                <h2 className="settings-card__title">Смена пароля</h2>
                <p className="settings-card__lead">Укажите текущий пароль и новый. После сохранения вход по-прежнему по телефону.</p>
                <p id="settings-password-error" className="settings-msg settings-msg--err" hidden />
                <p id="settings-password-ok" className="settings-msg settings-msg--ok" hidden>
                  Пароль обновлён.
                </p>
                <form id="form-settings-password" noValidate>
                  <div className="form-group">
                    <label htmlFor="settings-current-password">Текущий пароль</label>
                    <div className="settings-input-wrap">
                      <span className="settings-input-icon" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="10" rx="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </span>
                      <input
                        className="input settings-input"
                        type="password"
                        id="settings-current-password"
                        autoComplete="current-password"
                        required
                        suppressHydrationWarning
                      />
                      <button type="button" className="settings-input-toggle" id="settings-current-password-toggle" aria-label="Показать пароль">
                        <span className="settings-input-toggle__icon settings-input-toggle__icon--show" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </span>
                        <span className="settings-input-toggle__icon settings-input-toggle__icon--hide" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m3 3 18 18" />
                            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                            <path d="M9.4 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.7 18.7 0 0 1-3.1 4.2" />
                            <path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a10.6 10.6 0 0 0 5.4-1.5" />
                          </svg>
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="settings-new-password">Новый пароль</label>
                    <div className="settings-input-wrap">
                      <span className="settings-input-icon" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                        </svg>
                      </span>
                      <input
                        className="input settings-input"
                        type="password"
                        id="settings-new-password"
                        autoComplete="new-password"
                        minLength={6}
                        required
                        suppressHydrationWarning
                      />
                      <button type="button" className="settings-input-toggle" id="settings-new-password-toggle" aria-label="Показать пароль">
                        <span className="settings-input-toggle__icon settings-input-toggle__icon--show" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </span>
                        <span className="settings-input-toggle__icon settings-input-toggle__icon--hide" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m3 3 18 18" />
                            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                            <path d="M9.4 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.7 18.7 0 0 1-3.1 4.2" />
                            <path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a10.6 10.6 0 0 0 5.4-1.5" />
                          </svg>
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="settings-new-password2">Новый пароль ещё раз</label>
                    <div className="settings-input-wrap">
                      <span className="settings-input-icon" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </span>
                      <input
                        className="input settings-input"
                        type="password"
                        id="settings-new-password2"
                        autoComplete="new-password"
                        minLength={6}
                        required
                        suppressHydrationWarning
                      />
                      <button type="button" className="settings-input-toggle" id="settings-new-password2-toggle" aria-label="Показать пароль">
                        <span className="settings-input-toggle__icon settings-input-toggle__icon--show" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </span>
                        <span className="settings-input-toggle__icon settings-input-toggle__icon--hide" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m3 3 18 18" />
                            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                            <path d="M9.4 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.7 18.7 0 0 1-3.1 4.2" />
                            <path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a10.6 10.6 0 0 0 5.4-1.5" />
                          </svg>
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn btn--primary" id="settings-password-submit">
                      Сохранить пароль
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <div id="settings-panel-theme" className="settings-tab-panel" role="tabpanel" aria-labelledby="tab-settings-theme" hidden>
              <div className="settings-card">
                <h2 className="settings-card__title">Оформление</h2>
                <p className="settings-card__lead">Светлая тема удобна днём, тёмная — вечером и в слабоосвещённых помещениях. Выбор сохраняется на этом устройстве.</p>
                <div className="settings-seg" role="group" aria-label="Тема приложения">
                  <button type="button" className="settings-seg__btn settings-seg__btn--active" id="settings-theme-light" aria-pressed="true">
                    Светлая
                  </button>
                  <button type="button" className="settings-seg__btn" id="settings-theme-dark" aria-pressed="false">
                    Тёмная
                  </button>
                </div>
              </div>
            </div>

            <div id="settings-panel-notify" className="settings-tab-panel" role="tabpanel" aria-labelledby="tab-settings-notify" hidden>
              <div className="settings-card">
                <h2 className="settings-card__title">Почтовые уведомления</h2>
                <p className="settings-card__lead">Письма уходят на адрес из вашего профиля. Пароль и важные письма по безопасности приходят всегда.</p>
                <p id="settings-notify-error" className="settings-msg settings-msg--err" hidden />
                <label className="settings-option">
                  <input type="checkbox" id="settings-notify-chat" />
                  <span className="settings-switch" aria-hidden="true">
                    <span className="settings-switch__thumb"></span>
                  </span>
                  <span className="settings-option__text">
                    <span className="settings-option__label-row">
                      <span className="settings-option__label">Чат поддержки</span>
                      <span id="settings-notify-chat-status" className="settings-option__status" aria-live="polite"></span>
                    </span>
                    <span className="settings-option__hint">Когда поддержка ответит в чате, на почту сразу придёт письмо с текстом этого ответа.</span>
                  </span>
                </label>
                <label className="settings-option">
                  <input type="checkbox" id="settings-notify-raffle-orders" />
                  <span className="settings-switch" aria-hidden="true">
                    <span className="settings-switch__thumb"></span>
                  </span>
                  <span className="settings-option__text">
                    <span className="settings-option__label-row">
                      <span className="settings-option__label">Бронь и оплата</span>
                      <span id="settings-notify-raffle-orders-status" className="settings-option__status" aria-live="polite"></span>
                    </span>
                    <span className="settings-option__hint">Напоминание, что бронь скоро сгорит; письмо, если чек нужно заменить. Не зависит от рассылки о новых акциях.</span>
                  </span>
                </label>
              </div>
            </div>

            <div id="settings-panel-a11y" className="settings-tab-panel" role="tabpanel" aria-labelledby="tab-settings-a11y" hidden>
              <div className="settings-card">
                <h2 className="settings-card__title">Для слабовидящих</h2>
                <p className="settings-card__lead">Настройки ниже увеличивают читаемость интерфейса. Их можно комбинировать.</p>
                <label className="settings-option">
                  <input type="checkbox" id="settings-a11y-large" />
                  <span className="settings-switch" aria-hidden="true">
                    <span className="settings-switch__thumb"></span>
                  </span>
                  <span className="settings-option__text">
                    <span className="settings-option__label-row">
                      <span className="settings-option__label">Крупный текст</span>
                      <span id="settings-a11y-large-status" className="settings-option__status" aria-live="polite"></span>
                    </span>
                    <span className="settings-option__hint">Увеличивает базовый размер шрифта во всём приложении.</span>
                  </span>
                </label>
                <label className="settings-option">
                  <input type="checkbox" id="settings-a11y-contrast" />
                  <span className="settings-switch" aria-hidden="true">
                    <span className="settings-switch__thumb"></span>
                  </span>
                  <span className="settings-option__text">
                    <span className="settings-option__label-row">
                      <span className="settings-option__label">Повышенный контраст</span>
                      <span id="settings-a11y-contrast-status" className="settings-option__status" aria-live="polite"></span>
                    </span>
                    <span className="settings-option__hint">Более чёткие границы и насыщенные цвета текста.</span>
                  </span>
                </label>
                <label className="settings-option">
                  <input type="checkbox" id="settings-a11y-motion" />
                  <span className="settings-switch" aria-hidden="true">
                    <span className="settings-switch__thumb"></span>
                  </span>
                  <span className="settings-option__text">
                    <span className="settings-option__label-row">
                      <span className="settings-option__label">Меньше анимации</span>
                      <span id="settings-a11y-motion-status" className="settings-option__status" aria-live="polite"></span>
                    </span>
                    <span className="settings-option__hint">Сокращает движение и плавные переходы — удобнее при чувствительности к анимации.</span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>
        <SettingsDockClient />
      </div>
      <SettingsPageClient />
    </>
  );
}
